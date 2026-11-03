// Mission 5 — 팀이 직접 쓰는 테스트
// 1) src/orderQuery.js 를 리뷰해서 결함을 찾는다 (docs/REVIEW_NOTES.md 에 기록).
// 2) 결함마다 '고치기 전에 실패하는' 테스트를 아래에 작성한다. (실패하는 화면을 AI_USAGE_LOG 에 남긴다)
// 3) 결함을 고치고 테스트가 통과하는지 확인한다.
// 도구: createContext, createFakeClock, seedOrder (src/testkit.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, createFakeClock, seedOrder } = require("../src/testkit");
const { getOrderDetail, listOrders } = require("../src/orderQuery");

// 결함 1 — 보안·권한 (계약 5장 규칙 1)
test("결함 1: 다른 구매자의 주문 상세를 조회하면 NOT_FOUND 여야 한다 (남의 주문이 노출됨)", () => {
  const ctx = createContext();
  const o = seedOrder(ctx, { userId: "u1", items: [["P1", 1]] });
  assert.throws(() => getOrderDetail(ctx, "u2", o.id), (e) => e.code === "NOT_FOUND");
  // 없는 주문과 같은 코드여야 한다 (존재 여부를 알려 주지 않기 위해)
  assert.throws(() => getOrderDetail(ctx, "u2", "ORD-9999"), (e) => e.code === "NOT_FOUND");
});

// 결함 2 — 데이터 출처: 주문 시점 값 vs 현재 값 (계약 5장 규칙 2)
test("결함 2: 주문 후 상품 가격이 바뀌어도 상세의 단가 · 금액은 주문 시점 값이어야 한다", () => {
  const ctx = createContext();
  const o = seedOrder(ctx, { userId: "u1", items: [["P1", 2]] }); // 주문 시점 단가 15000
  ctx.store.products.get("P1").price = 99999; // 주문 이후 가격 인상
  const d = getOrderDetail(ctx, "u1", o.id);
  assert.equal(d.items[0].unitPrice, 15000);
  assert.equal(d.items[0].lineTotal, 30000);
  assert.equal(d.totalAmount, 30000);
});

// 결함 3 — 정렬 (계약 5장 규칙 3)
test("결함 3: 목록은 최신순이고, 같은 시각이면 주문번호가 큰 것이 먼저여야 한다", () => {
  const clock = createFakeClock();
  const ctx = createContext({ clock });
  const first = seedOrder(ctx, { userId: "u1", deductStock: false }); // ORD-0001, 가장 오래됨
  clock.advanceMinutes(10);
  const second = seedOrder(ctx, { userId: "u1", deductStock: false }); // ORD-0002
  const third = seedOrder(ctx, { userId: "u1", deductStock: false }); // ORD-0003, 같은 시각
  const ids = listOrders(ctx, "u1").items.map((i) => i.orderId);
  assert.deepEqual(ids, [third.id, second.id, first.id]);
});

// 결함 4 — 페이지 계산 (계약 5장 규칙 4)
test("결함 4: 페이지는 1부터 시작한다 (12건 중 1쪽은 10건, 2쪽은 2건, 3쪽은 빈 목록)", () => {
  const ctx = createContext();
  for (let i = 0; i < 12; i++) seedOrder(ctx, { userId: "u1", deductStock: false });
  const p1 = listOrders(ctx, "u1", { page: 1, pageSize: 10 });
  const p2 = listOrders(ctx, "u1", { page: 2, pageSize: 10 });
  const p3 = listOrders(ctx, "u1", { page: 3, pageSize: 10 });
  assert.equal(p1.total, 12);
  assert.equal(p1.items.length, 10);
  assert.equal(p2.items.length, 2);
  assert.deepEqual(p3.items, []);
});

// 결함 5 — 표시 규칙 (계약 5장 규칙 5)
test("결함 5: 대표 상품명은 상품 종류가 여럿이면 '{첫 상품명} 외 {나머지 종류 수}건' 이다", () => {
  const ctx = createContext();
  seedOrder(ctx, { userId: "u1", items: [["P1", 1], ["P2", 1], ["P5", 1]], deductStock: false }); // 3종
  seedOrder(ctx, { userId: "u1", items: [["P1", 2]], deductStock: false }); // 1종
  const byName = listOrders(ctx, "u1").items.map((i) => i.representativeName);
  assert.ok(byName.includes("무선 마우스 외 2건"), `3종 주문의 대표 이름: ${byName.join(" | ")}`);
  assert.ok(byName.includes("무선 마우스"), "1종 주문은 상품명만");
});