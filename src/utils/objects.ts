function recurse(obj: Record<string, any>, keys: string[], currPath: string) {
  if (obj && !(obj instanceof Array) && typeof obj == "object") {
    Object.keys(obj).forEach((key) => {
      const nestedPath = currPath ? currPath + "." + key : key;
      keys.push(nestedPath);
      recurse(obj[key], keys, nestedPath);
    });
  }
}

function getNestedKeys(obj: Record<string, any>): string[] {
  const keys: string[] = [];
  recurse(obj, keys, "");
  return keys;
}

function isJSON(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch (err) {
    return false;
  }
}

const objectsUtils = {
  getNestedKeys,
  isJSON,
};

export default objectsUtils;