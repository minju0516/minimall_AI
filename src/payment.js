// Mission 3 — 결제 (SRS: FR-PAY-01, FR-PAY-02, FR-PAY-05 / US-08)
// 계약은 docs/API_CONTRACT.md 의 "3. 결제" 를 읽는다. 외부 결제대행사는 ctx.pg (모의 PG) 로 호출한다.
const { AppError } = require("./errors");
const { copy, findOwnedOrder } = require("./util");
const { changeStatus } = require("./order");

// 이 주문의 '성공한' 결제 기록. 없으면 undefined.
function findSucceeded(ctx, orderId) {
  return (ctx.store.payments.get(orderId) ?? []).find((p) => p.status === "SUCCEEDED");
}

// 결제 시도 1건을 기록으로 쌓는다. attempt 는 1부터 증가한다. (카드번호 등 결제 수단 필드는 만들지 않는다)
function startAttempt(ctx, order) {
  const list = ctx.store.payments.get(order.id) ?? [];
  ctx.store.payments.set(order.id, list);
  ctx.store.seq.payment += 1;
  const payment = {
    id: `PAY-${String(ctx.store.seq.payment).padStart(4, "0")}`,
    orderId: order.id,
    amount: order.totalAmount, // 서버가 가진 주문 금액
    status: "PENDING",
    attempt: list.length + 1,
  };
  list.push(payment);
  return payment;
}

// 같은 결과를 여러 호출자에게 줄 때도 호출자마다 복사본을 준다.
const copyResult = (r) => ({ order: copy(r.order), payment: copy(r.payment), alreadyPaid: r.alreadyPaid });

// PG 에 결제를 한 번 요청한다. 성공이면 주문을 PAID 로, 실패 · 시간 초과이면 PAYMENT_FAILED 를 던진다.
async function chargeOnce(ctx, order) {
  const payment = startAttempt(ctx, order);

  let result;
  try {
    result = await ctx.pg.charge({
      orderId: order.id,
      amount: order.totalAmount,
      idempotencyKey: `${order.id}-attempt-${payment.attempt}`, // 시도마다 다른 키
    });
  } catch (e) {
    result = { ok: false, reason: "PG_ERROR" }; // 시간 초과 등 예외 → 실패로 취급. 기록이 PENDING 으로 남지 않게 여기서 잡는다.
  }

  if (!result.ok) {
    payment.status = "FAILED";
    payment.failureReason = result.reason;
    // 주문은 PENDING_PAYMENT 그대로 둔다. (다시 결제할 수 있도록)
    throw new AppError("PAYMENT_FAILED", "결제에 실패했습니다", { reason: result.reason });
  }

  payment.status = "SUCCEEDED";
  payment.txId = result.txId;
  payment.paidAt = ctx.clock.now().toISOString();
  const paidOrder = changeStatus(ctx, order.id, "PAID");
  return { order: paidOrder, payment: copy(payment), alreadyPaid: false };
}

// 본인의 '결제대기' 주문을 결제한다. 성공하면 { order, payment, alreadyPaid } 를 돌려준다.
// 아래 검사와 ctx.store.inflight 등록은 첫 await 전에 끝나므로, 같은 주문의 동시 요청은 서로를 볼 수 있다.
async function payOrder(ctx, userId, orderId) {
  const order = findOwnedOrder(ctx, userId, orderId); // 규칙 1: 없는 주문 · 남의 주문은 NOT_FOUND

  // 규칙 2: 이미 결제된 주문은 PG 에 다시 요청하지 않고 기존 결과를 돌려준다.
  const done = findSucceeded(ctx, orderId);
  if (done) return { order: copy(order), payment: copy(done), alreadyPaid: true };

  // 규칙 7: 같은 주문의 결제가 이미 진행 중이면 PG 에 또 요청하지 않고 그 결과(성공이든 같은 실패든)를 함께 받는다.
  const key = `pay:${orderId}`; // 규칙 8: 키에 주문번호가 들어 있어 다른 주문과 섞이지 않는다.
  if (ctx.store.inflight.has(key)) return copyResult(await ctx.store.inflight.get(key));

  if (order.status !== "PENDING_PAYMENT") {
    // 규칙 3: 결제대기가 아니면 PG 에 요청하지 않는다.
    throw new AppError("INVALID_STATE", "결제할 수 없는 주문 상태입니다", { status: order.status });
  }

  const task = chargeOnce(ctx, order);
  ctx.store.inflight.set(key, task);
  try {
    return copyResult(await task);
  } finally {
    ctx.store.inflight.delete(key); // 성공이든 실패든 정리한다. (안 지우면 다음 재결제가 막힌다)
  }
}

module.exports = { payOrder };