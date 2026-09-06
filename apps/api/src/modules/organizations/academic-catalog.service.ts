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

export interface AcademicCatalogRepository {
  listVisibleTo(
    actorUserId: string,
  ): Promise<AcademicCatalogFaculty[]>
}

export interface AcademicCatalogUseCase {
  listVisibleCatalog(
    actorUserId: string,
  ): Promise<AcademicCatalogFaculty[]>
}

export class AcademicCatalogService
implements AcademicCatalogUseCase {
  constructor(
    private readonly repository:
      AcademicCatalogRepository,
  ) {}

  listVisibleCatalog(
    actorUserId: string,
  ): Promise<AcademicCatalogFaculty[]> {
    return this.repository
      .listVisibleTo(actorUserId)
  }
}
