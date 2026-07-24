import { createHash, createHmac, randomBytes } from "node:crypto";

const suppliedPassword = process.argv[2];
if (suppliedPassword && suppliedPassword.length < 24) {
  console.error("직접 지정하는 비밀번호는 24자 이상이어야 합니다. 인수를 생략하면 강한 비밀번호를 자동 생성합니다.");
  process.exit(1);
}

const password = suppliedPassword || randomBytes(24).toString("base64url");
const salt = randomBytes(32);
const digest = createHmac("sha256", Buffer.from(password, "utf8")).update(salt).digest();
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
const passwordHash = `hmac-sha256$1$${base64url(salt)}$${base64url(digest)}`;
const issuer = encodeURIComponent("Minecraft.kr 총관리자");
const label = encodeURIComponent(`Minecraft.kr:${email}`);
const uri = `otpauth://totp/${label}?secret=${totpSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

if (!suppliedPassword) console.log(`ADMIN_LOGIN_PASSWORD="${password}"`);
console.log(`ADMIN_EMAIL="${email}"`);
console.log(`ADMIN_PASSWORD_HASH="${passwordHash}"`);
console.log(`ADMIN_TOTP_SECRET="${totpSecret}"`);
console.log(`OTP_URI="${uri}"`);
console.log(`설정 지문: ${createHash("sha256").update(passwordHash + totpSecret).digest("hex").slice(0, 16)}`);
