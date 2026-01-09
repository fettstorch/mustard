type PageUrl = string
type UserId = string

export class MustardIndex {
  constructor(private index: Map<UserId, PageUrl[]>) {}

  getUsersForPage(pageUrl: PageUrl): UserId[] {
    return this.entries()
      .filter((entry) => entry[1].includes(pageUrl))
      .map((entry) => entry[0])
  }

  getPagesForUser(userId: UserId): PageUrl[] {
    return this.index.get(userId) ?? []
  }

  entries(): [UserId, PageUrl[]][] {
    return [...this.index.entries()]
  }

  merge(other: MustardIndex): MustardIndex {
    return new MustardIndex(new Map([...this.index.entries(), ...other.index.entries()]))
  }
}
