// Mission 4 — 주문 취소와 환불 (SRS: FR-ORD-04, FR-PAY-03, FR-STK-01 / US-10)
// 계약은 docs/API_CONTRACT.md 의 "4. 취소 · 환불" 을 읽는다.
const { AppError } = require("./errors");
const { copy, findOwnedOrder, restoreStock } = require("./util");
const { changeStatus } = require("./order");

const CANCELABLE = ["PENDING_PAYMENT", "PAID"]; // 규칙 2: 취소할 수 있는 상태는 이 둘뿐

// 실제 취소 작업.
async function doCancel(ctx, order) {
  if (order.status === "PENDING_PAYMENT") {
    // 규칙 3: PG 호출 없이 취소하고 재고를 복원한다.
    const canceled = changeStatus(ctx, order.id, "CANCELED");
    restoreStock(ctx, order);
    return { order: canceled };
  }

  // 규칙 4: PAID 취소는 성공한 결제 금액으로 환불을 요청한다.
  const payment = (ctx.store.payments.get(order.id) ?? []).find((p) => p.status === "SUCCEEDED");
  if (!payment) {
    throw new AppError("INVALID_STATE", "성공한 결제 기록이 없어 환불할 수 없습니다", { orderId: order.id });
  }

  let result;
  try {
    result = await ctx.pg.refund({ txId: payment.txId, amount: payment.amount });
  } catch (e) {
    result = { ok: false, reason: "PG_ERROR" }; // 시간 초과 등 예외도 환불 실패로 취급
  }
  const at = ctx.clock.now().toISOString();

  if (!result.ok) {
    // 환불이 실패했으면 주문 상태와 재고에는 손대지 않는다. (PAID 유지, 재고 복원 없음 → 나중에 다시 취소 가능)
    payment.refund = { status: "FAILED", reason: result.reason, at };
    throw new AppError("REFUND_FAILED", "환불에 실패했습니다", { reason: result.reason });
  }

  // 환불이 성공한 "뒤에만" 상태와 재고를 바꾼다.
  payment.status = "REFUNDED";
  payment.refund = { status: "SUCCEEDED", refundId: result.refundId, at };
  const canceled = changeStatus(ctx, order.id, "CANCELED");
  restoreStock(ctx, order);
  return { order: canceled };
}

// 본인의 주문을 취소한다. 성공하면 { order } 를 돌려준다.
// 아래 검사와 ctx.store.inflight 등록은 첫 await 전에 끝나므로, 같은 주문의 동시 취소는 서로를 볼 수 있다.
async function cancelOrder(ctx, userId, orderId) {
  const order = findOwnedOrder(ctx, userId, orderId); // 규칙 1: 없는 주문 · 남의 주문은 NOT_FOUND

  // 규칙 5: 같은 주문의 취소가 이미 진행 중이면 환불 · 재고 복원을 또 하지 않고 그 결과를 함께 받는다.
  const key = `cancel:${orderId}`;
  if (ctx.store.inflight.has(key)) {
    const shared = await ctx.store.inflight.get(key);
    return { order: copy(shared.order) };
  }

  if (!CANCELABLE.includes(order.status)) {
    // 규칙 2: 환불 · 재고에 아무 일도 일어나지 않고 오류만 던진다.
    throw new AppError("INVALID_STATE", "취소할 수 없는 주문 상태입니다", { status: order.status });
  }

  const task = doCancel(ctx, order);
  ctx.store.inflight.set(key, task);
  try {
    const result = await task;
    return { order: copy(result.order) };
  } finally {
    ctx.store.inflight.delete(key); // 성공이든 실패든 정리한다. (안 지우면 다음 재시도가 막힌다)
  }
}

module.exports = { cancelOrder };