import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("사용법: pnpm admin:credentials '12자 이상의 강한 비밀번호'");
  process.exit(1);
}

const iterations = 310_000;
const salt = randomBytes(18);
const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const secret = randomBytes(20);
const email = (process.env.ADMIN_EMAIL || "admin@minecraft.kr").toLowerCase();
const base64url = (value) => value.toString("base64url");
const base32 = (value) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
};

const totpSecret = base32(secret);
const passwordHash = `pbkdf2$${iterations}$${base64url(salt)}$${base64url(digest)}`;
const issuer = encodeURIComponent("Minecraft.kr 총관리자");
const label = encodeURIComponent(`Minecraft.kr:${email}`);
const uri = `otpauth://totp/${label}?secret=${totpSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

console.log(`ADMIN_EMAIL="${email}"`);
console.log(`ADMIN_PASSWORD_HASH="${passwordHash}"`);
console.log(`ADMIN_TOTP_SECRET="${totpSecret}"`);
console.log(`OTP_URI="${uri}"`);
console.log(`설정 지문: ${createHash("sha256").update(passwordHash + totpSecret).digest("hex").slice(0, 16)}`);
