import { checkSubmissionDocumentRuntime } from '../dist/modules/submissions/submission-document-runtime.js'
const report = await checkSubmissionDocumentRuntime()
console.log(JSON.stringify(report, null, 2))
if (report.status !== 'READY') process.exitCode = 1
