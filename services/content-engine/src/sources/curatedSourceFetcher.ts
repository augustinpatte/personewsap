import type { CuratedSource, SourceConnector, SourceFetchRequest } from "./types.js";

export class CuratedSourceConnector implements SourceConnector {
  readonly name = "curated_sources";

  constructor(private readonly sources: CuratedSource[]) {}

  async fetchArticles(_request: SourceFetchRequest): Promise<[]> {
    void this.sources;
    return [];
  }
}
