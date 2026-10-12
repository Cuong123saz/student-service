# Private protocol; no HTTP or user-selected path is read here.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$source = @"
using System;
using System.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
public static class StudentDocumentJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A,B,C,D,E,F; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
    public BasicLimit Basic; public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUser, PeriodKernel;
    public uint Faults, Total, Active, Terminated;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint Size; public string Reserved, Desktop, Title;
    public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags; public ushort Show, ReservedSize;
    public IntPtr ReservedBytes, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimit limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,ref Accounting accounting,uint size,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr key,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)] struct Security {public uint Size;public IntPtr Descriptor;public bool Inherit;}
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref Security security,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint sharing,ref Security security,uint creation,uint flags,IntPtr template);
  static uint Active(IntPtr job) {
    Accounting a=new Accounting();
    if(!QueryInformationJobObject(job,1,ref a,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new Exception("JOB_QUERY_FAILED");
    return a.Active;
  }
  static string Quote(string value) {
    StringBuilder b=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) {
      if(c=='\\') {slashes++;continue;}
      if(c=='"') {b.Append('\\',slashes*2+1);b.Append(c);}
      else {b.Append('\\',slashes);b.Append(c);}
      slashes=0;
    }
    b.Append('\\',slashes*2);b.Append('"');return b.ToString();
  }
  public static string ReadHeader() {
    StringBuilder line=new StringBuilder();
    while(true) {
      int ch=Console.In.Read();
      if(ch<0)throw new Exception("OWNER_DISCONNECTED");
      if(ch==10)return line.ToString();
      if(line.Length>=65536)throw new Exception("HEADER_LIMIT");
      line.Append((char)ch);
    }
  }
  public static void Run(string command,string[] args,int timeout,long deadline,bool capture) {
    IntPtr job=IntPtr.Zero,list=IntPtr.Zero,jobList=IntPtr.Zero,handles=IntPtr.Zero,pipeRead=IntPtr.Zero,pipeWrite=IntPtr.Zero,nul=IntPtr.Zero;
    Task<byte[]> outputReader=null;byte[] output=new byte[0];
    ProcessInfo process=new ProcessInfo();bool attributesReady=false,created=false,empty=false;
    string reason="FAILED";uint exitCode=1;
    try {
      if(!Path.IsPathRooted(command)||command.IndexOf('\0')>=0||args.Length>100||timeout<1||timeout>90000)throw new Exception("INVALID_CONFIG");
      long now=(long)(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;
      long remaining=deadline-now;
      if(remaining<=0)throw new TimeoutException();
      if(remaining>90000)throw new Exception("INVALID_DEADLINE");
      timeout=Math.Min(timeout,(int)remaining);
      StringBuilder line=new StringBuilder(Quote(command));
      foreach(string arg in args){if(arg==null||arg.IndexOf('\0')>=0)throw new Exception("INVALID_ARG");line.Append(' ');line.Append(Quote(arg));}
      if(line.Length>30000)throw new Exception("COMMAND_LIMIT");
      job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Exception("JOB_CREATE_FAILED");
      ExtendedLimit limits=new ExtendedLimit();limits.Basic.Flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit))))throw new Exception("JOB_LIMIT_FAILED");
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,capture?2:1,0,ref size);
      list=Marshal.AllocHGlobal(size);
      if(!InitializeProcThreadAttributeList(list,capture?2:1,0,ref size))throw new Exception("ATTRIBUTE_INIT_FAILED");attributesReady=true;
      jobList=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobList,job);
      // Atomic assignment: no spawn/assign interval that could orphan a process.
      if(!UpdateProcThreadAttribute(list,0,new IntPtr(0x2000d),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero))throw new Exception("JOB_ATTRIBUTE_FAILED");
      StartupEx startup=new StartupEx();startup.Startup.Size=(uint)Marshal.SizeOf(typeof(StartupEx));startup.Attributes=list;
      if(capture) {
        Security security=new Security();security.Size=(uint)Marshal.SizeOf(typeof(Security));security.Inherit=true;
        if(!CreatePipe(out pipeRead,out pipeWrite,ref security,4096)||!SetHandleInformation(pipeRead,1,0))throw new Exception("PIPE_FAILED");
        nul=CreateFile("NUL",0xc0000000,3,ref security,3,0,IntPtr.Zero);
        if(nul==new IntPtr(-1))throw new Exception("NUL_FAILED");
        handles=Marshal.AllocHGlobal(IntPtr.Size*2);Marshal.WriteIntPtr(handles,pipeWrite);Marshal.WriteIntPtr(handles,IntPtr.Size,nul);
        if(!UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero))throw new Exception("HANDLE_ATTRIBUTE_FAILED");
        startup.Startup.Flags=0x100;startup.Startup.Input=nul;startup.Startup.Output=pipeWrite;startup.Startup.Error=pipeWrite;
      }
      if(!CreateProcess(command,line,IntPtr.Zero,IntPtr.Zero,capture,0x08080000,IntPtr.Zero,null,ref startup,out process))throw new Exception("PROCESS_CREATE_FAILED");
      created=true;CloseHandle(process.Thread);process.Thread=IntPtr.Zero;
      if(capture) {
        CloseHandle(pipeWrite);pipeWrite=IntPtr.Zero;CloseHandle(nul);nul=IntPtr.Zero;
        FileStream stream=new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(pipeRead,true),FileAccess.Read,4096,false);pipeRead=IntPtr.Zero;
        outputReader=Task.Factory.StartNew(()=>{using(stream){using(MemoryStream bytes=new MemoryStream()){
          byte[] block=new byte[4097];int count;while((count=stream.Read(block,0,block.Length))>0){if(bytes.Length+count>4096)throw new Exception("OUTPUT_LIMIT");bytes.Write(block,0,count);}return bytes.ToArray();
        }}},TaskCreationOptions.LongRunning);
      }
      Console.WriteLine("{\"type\":\"STARTED\",\"pid\":"+process.Pid+"}");Console.Out.Flush();
      Task<int> owner=Task.Factory.StartNew(()=>Console.In.Read(),TaskCreationOptions.LongRunning);
      Stopwatch clock=Stopwatch.StartNew();
      while(true) {
        if(outputReader!=null&&outputReader.IsFaulted){reason="FAILED";break;}
        if(owner.IsCompleted){reason="CANCELLED";break;}
        if(clock.ElapsedMilliseconds>=timeout){reason="TIMEOUT";break;}
        uint wait=WaitForSingleObject(process.Process,25);
        if(wait==0) {
          if(!GetExitCodeProcess(process.Process,out exitCode))throw new Exception("EXIT_QUERY_FAILED");
          CloseHandle(process.Process);process.Process=IntPtr.Zero;
          Stopwatch grace=Stopwatch.StartNew();while(Active(job)>0&&grace.ElapsedMilliseconds<500)Thread.Sleep(10);
          reason=Active(job)==0?(exitCode==0?"EXITED":"FAILED"):"ABANDONED_CHILD";break;
        }
        if(wait!=258)throw new Exception("PROCESS_WAIT_FAILED");
      }
    } catch(TimeoutException) {reason="TIMEOUT";} catch {reason="FAILED";}
    finally {
      try {
        if(job!=IntPtr.Zero) {
          if(Active(job)>0&&!TerminateJobObject(job,1))throw new Exception("JOB_TERMINATE_FAILED");
          if(process.Process!=IntPtr.Zero){WaitForSingleObject(process.Process,5000);CloseHandle(process.Process);process.Process=IntPtr.Zero;}
          Stopwatch reap=Stopwatch.StartNew();while(Active(job)>0&&reap.ElapsedMilliseconds<5000)Thread.Sleep(10);
          empty=Active(job)==0;
        } else empty=!created;
      } catch {empty=false;}
      if(process.Thread!=IntPtr.Zero)CloseHandle(process.Thread);
      if(process.Process!=IntPtr.Zero)CloseHandle(process.Process);
      if(job!=IntPtr.Zero)CloseHandle(job);
      if(attributesReady)DeleteProcThreadAttributeList(list);
      if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);
      if(jobList!=IntPtr.Zero)Marshal.FreeHGlobal(jobList);
      if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);
      if(pipeWrite!=IntPtr.Zero)CloseHandle(pipeWrite);
      if(pipeRead!=IntPtr.Zero)CloseHandle(pipeRead);
      if(nul!=IntPtr.Zero&&nul!=new IntPtr(-1))CloseHandle(nul);
      if(outputReader!=null){try{if(outputReader.Wait(2000))output=outputReader.Result;else reason="FAILED";}catch{reason="FAILED";}}
    }
    Console.WriteLine("{\"type\":\"RESULT\",\"reason\":\""+reason+"\",\"empty\":"+(empty?"true":"false")+(capture?",\"outputBase64\":\""+Convert.ToBase64String(output)+"\"":"")+"}");Console.Out.Flush();
  }
}
"@
try {
  Add-Type -TypeDefinition $source
  $header = [StudentDocumentJob]::ReadHeader()
  $config = ConvertFrom-Json -InputObject $header
  [StudentDocumentJob]::Run([string]$config.command, [string[]]$config.args, [int]$config.timeoutMs, [long]$config.deadlineUnixMs, [bool]$config.captureOutput)
} catch {
  [Console]::WriteLine('{"type":"RESULT","reason":"FAILED","empty":true}')
  exit 1
}
[Environment]::Exit(0)
