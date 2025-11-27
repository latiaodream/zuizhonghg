const randomFromAlphabet = (alphabet: string, length: number): string => {
  if (!alphabet.length || length <= 0) {
    return '';
  }

  let result = '';
  const cryptoCandidate = typeof globalThis !== 'undefined' ? (globalThis.crypto || undefined) : undefined;
  const cryptoObj = cryptoCandidate && typeof cryptoCandidate.getRandomValues === 'function'
    ? cryptoCandidate
    : undefined;

  if (cryptoObj) {
    const array = new Uint32Array(length);
    cryptoObj.getRandomValues(array);
    for (let i = 0; i < length; i += 1) {
      const index = array[i] % alphabet.length;
      result += alphabet[index];
    }
    return result;
  }

  for (let i = 0; i < length; i += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    result += alphabet[randomIndex];
  }
  return result;
};

export const generateAccountUsername = (length = 10): string => {
  const minLength = 6;
  const maxLength = 12;
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const alphabet = `${letters}${digits}`;
  const targetLength = Math.max(minLength, Math.min(maxLength, length));

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = randomFromAlphabet(alphabet, targetLength);
    const letterCount = Array.from(candidate).filter(ch => letters.includes(ch)).length;
    const digitCount = Array.from(candidate).filter(ch => digits.includes(ch)).length;

    if (letterCount >= 2 && digitCount >= 1) {
      return candidate;
    }
  }

  // 兜底策略：强制构造一个符合规则的字符串
  const fallbackBase = randomFromAlphabet(letters, targetLength - 3);
  const forced = `${fallbackBase}${randomFromAlphabet(letters, 2)}${randomFromAlphabet(digits, 1)}`;
  return forced.slice(0, targetLength);
};

export const generateAccountPassword = (length = 12): string => {
  const minLength = 6;
  const maxLength = 12;
  const lettersLower = 'abcdefghijklmnopqrstuvwxyz';
  const lettersUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const alphabet = `${lettersLower}${lettersUpper}${digits}`;
  const targetLength = Math.max(minLength, Math.min(maxLength, length));

  const isValid = (value: string) => {
    if (value.length < minLength || value.length > maxLength) {
      return false;
    }
    const chars = Array.from(value);
    const letterCount = chars.filter(ch => lettersLower.includes(ch) || lettersUpper.includes(ch)).length;
    const digitCount = chars.filter(ch => digits.includes(ch)).length;
    const distinctCount = new Set(chars).size;
    return letterCount >= 2 && digitCount >= 1 && distinctCount >= 3;
  };

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = randomFromAlphabet(alphabet, targetLength);
    if (isValid(candidate)) {
      return candidate;
    }
  }

  // fallback: construct deterministic valid password
  const base = randomFromAlphabet(lettersLower + lettersUpper, Math.max(3, targetLength - 3));
  const forced = `${base}${randomFromAlphabet(lettersUpper, 1)}${randomFromAlphabet(lettersLower, 1)}${randomFromAlphabet(digits, 1)}`;
  const trimmed = forced.slice(0, targetLength);
  return isValid(trimmed) ? trimmed : 'Abc123';
};

export default {
  generateAccountUsername,
  generateAccountPassword,
};
