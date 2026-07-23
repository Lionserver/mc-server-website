export const SERVER_CATEGORY_LIMIT = 3;
export const SERVER_CATEGORY_KOREAN_LIMIT = 5;
export const SERVER_CATEGORY_ENGLISH_LIMIT = 8;

const CATEGORY_WIDTH_LIMIT = 40;
const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
const CATEGORY_PATTERN = /^[A-Za-z0-9\u3130-\u318f\uac00-\ud7af][A-Za-z0-9\u3130-\u318f\uac00-\ud7af .+&/_-]*$/u;

export function normalizeServerCategory(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function serverCategoryError(value: string) {
  const category = normalizeServerCategory(value);
  if (!category) return "카테고리 이름을 입력해 주세요.";
  if (category === "전체") return "‘전체’는 필터 전용 이름이라 카테고리로 사용할 수 없습니다.";
  if (!CATEGORY_PATTERN.test(category)) {
    return "한글·영문·숫자와 공백, +, &, -, _, /, .만 사용할 수 있습니다.";
  }
  const width = [...category].reduce((total, character) => {
    if (HANGUL_PATTERN.test(character)) return total + 8;
    if (character === " ") return total + 3;
    return total + 5;
  }, 0);
  if (width > CATEGORY_WIDTH_LIMIT) {
    return `카테고리 하나는 한글 ${SERVER_CATEGORY_KOREAN_LIMIT}자 또는 영문·숫자 ${SERVER_CATEGORY_ENGLISH_LIMIT}자까지 입력할 수 있습니다.`;
  }
  return null;
}

export function parseServerCategories(value: unknown) {
  if (!Array.isArray(value)) throw new Error("카테고리를 확인해 주세요.");
  const categories: string[] = [];
  const keys = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new Error("카테고리를 확인해 주세요.");
    const category = normalizeServerCategory(item);
    const error = serverCategoryError(category);
    if (error) throw new Error(error);
    const key = category.toLowerCase();
    if (keys.has(key)) continue;
    keys.add(key);
    categories.push(category);
  }
  if (categories.length < 1) throw new Error("카테고리를 1개 이상 추가해 주세요.");
  if (categories.length > SERVER_CATEGORY_LIMIT) throw new Error(`카테고리는 최대 ${SERVER_CATEGORY_LIMIT}개까지 등록할 수 있습니다.`);
  return categories;
}

export function readStoredServerCategories(value: unknown) {
  if (!Array.isArray(value)) return [];
  const categories: string[] = [];
  const keys = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const category = normalizeServerCategory(item);
    if (serverCategoryError(category)) continue;
    const key = category.toLowerCase();
    if (keys.has(key)) continue;
    keys.add(key);
    categories.push(category);
    if (categories.length === SERVER_CATEGORY_LIMIT) break;
  }
  return categories;
}
