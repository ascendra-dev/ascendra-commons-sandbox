/** An actor's resolved permissions from one source. `grantsAll` short-circuits `actions`. */
export interface ResolvedPermissions {
  actions: ReadonlySet<string>;
  grantsAll: boolean;
}
