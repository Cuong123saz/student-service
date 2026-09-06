export interface AcademicCatalogClass {
  id: string
  code: string
  name: string
}

export interface AcademicCatalogFaculty {
  id: string
  code: string
  name: string
  classes: AcademicCatalogClass[]
}

export interface AcademicCatalogResponse {
  faculties: AcademicCatalogFaculty[]
}
