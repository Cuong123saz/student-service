export interface AdminSessionUser {
  id: string
  username: string
  mustChangePassword: boolean
  roles: string[]
}

export interface AdminLoginInput {
  username: string
  password: string
}

export interface AdminChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface AdminLoginResponse {
  user: AdminSessionUser
}

export interface CurrentAdminResponse {
  user: AdminSessionUser
}
export interface UserSessionUser {
  id: string
  username: string
  mustChangePassword: boolean
  roles: string[]
}

export interface UserLoginInput {
  username: string
  password: string
}

export interface UserLoginResponse {
  user: UserSessionUser
}

export interface CurrentUserResponse {
  user: UserSessionUser
}