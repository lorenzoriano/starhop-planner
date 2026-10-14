/** Preserve saved observations when correcting misleading historical catalog IDs. */
export const TARGET_ID_ALIASES:Record<string,string> = {
  "DS-16Cyg":"DS-16Dra", "DS-DelCep":"DS-OmCep", "AST-IC37":"NGC2169",
};
export const canonicalTargetId=(id:string)=>TARGET_ID_ALIASES[id]??id;
