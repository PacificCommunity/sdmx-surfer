declare module "sdmx-json-parser" {
  export class SDMXParser {
    getDatasets(url: string, opts?: RequestInit): Promise<unknown>;
    getData(): Array<Record<string, string | number | undefined>>;
    getName(): unknown;
    getDescription(): unknown;
    getAttributes(): unknown;
    getDimensions(): unknown;
    getObservations(): unknown;
  }
  const def: { SDMXParser: typeof SDMXParser };
  export default def;
}
