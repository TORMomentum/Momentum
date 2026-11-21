import assert from "node:assert/strict";

const origin = process.env.APP_ORIGIN;
assert.ok(origin, "Set APP_ORIGIN to the running web service");
const options = { headers: { cookie: "tor-radar-session=expired-fixture" }, redirect: "manual" };
for (const [path, action] of [["/reset-password", "บันทึกรหัสผ่านใหม่"], ["/verify", "กดปุ่มเพื่อยืนยันอีเมลของคุณ"]]) {
  const response = await fetch(new URL(path + "?token=email-action-fixture", origin), options);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.ok(html.includes(action), path);
  assert.ok(!html.includes("/api/auth/expired"), path);
}
const protectedPage = await fetch(new URL("/account", origin), options);
const redirectLocation = protectedPage.headers.get("location");
if (redirectLocation) {
  assert.equal(new URL(redirectLocation, origin).pathname, "/api/auth/expired");
} else {
  // A streamed Next page carries the redirect instruction inside the HTML.
  assert.match(await protectedPage.text(), /NEXT_REDIRECT;replace;\/api\/auth\/expired;/);
}
console.log("Email action pages and protected account redirect passed.");
