// ISO 6346 container identifier validation (owner code 3 letters + category U/J/Z + 6 digits + check digit).
// Shared by the Hedera, Solana and EVM scripts so a bad container id never reaches a chain.

const LETTER_VALUES = (() => {
  const m = {};
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v++; // skip multiples of 11
    m[ch] = v++;
  }
  return m;
})();

function checkDigit(first10) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i];
    const val = /[0-9]/.test(ch) ? Number(ch) : LETTER_VALUES[ch];
    sum += val * 2 ** i;
  }
  return (sum % 11) % 10;
}

function validateIso6346(id) {
  const s = String(id || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(s)) return { valid: false, reason: "format: AAA[UJZ]#######" };
  const expected = checkDigit(s.slice(0, 10));
  if (expected !== Number(s[10])) return { valid: false, reason: `check digit should be ${expected}` };
  return { valid: true, id: s };
}

module.exports = { validateIso6346, checkDigit };
