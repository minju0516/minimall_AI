// Mission 2 — 주문 생성과 상태 관리 (SRS: FR-ORD-01, FR-ORD-02, FR-STK-01~03 / US-07)
// 계약은 docs/API_CONTRACT.md 의 "2. 주문" 을 읽는다.
const { AppError } = require("./errors");
const { copy } = require("./util");

const ORDER_STATUS = {
  PENDING_PAYMENT: "PENDING_PAYMENT", // 결제대기
  PAID: "PAID", // 결제완료
  PREPARING: "PREPARING", // 배송준비
  SHIPPING: "SHIPPING", // 배송중
  DELIVERED: "DELIVERED", // 배송완료
  CANCELED: "CANCELED", // 취소
};

// 상태 전이표(API_CONTRACT.md 2장). 규칙을 코드가 아니라 데이터로 둔다.
const TRANSITIONS = {
  [ORDER_STATUS.PENDING_PAYMENT]: [ORDER_STATUS.PAID, ORDER_STATUS.CANCELED],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.SHIPPING],
  [ORDER_STATUS.SHIPPING]: [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELED]: [],
};

// from 상태에서 to 상태로 바꿀 수 있으면 true. (docs/API_CONTRACT.md 의 상태 전이표 참고)
function canTransition(from, to) {
  if (!Object.hasOwn(TRANSITIONS, from)) return false; // 모르는 상태는 허용하지 않는다
  return TRANSITIONS[from].includes(to);
}

// 주문 상태를 바꾼다. 없는 주문은 NOT_FOUND, 허용되지 않은 전이는 INVALID_STATE. 바뀐 주문의 복사본을 돌려준다.
function changeStatus(ctx, orderId, to) {
  const order = ctx.store.orders.get(orderId);
  if (!order) {
    throw new AppError("NOT_FOUND", "주문을 찾을 수 없습니다", { orderId });
  }
  if (!canTransition(order.status, to)) {
    throw new AppError("INVALID_STATE", "허용되지 않은 주문 상태 변경입니다", { from: order.status, to });
  }
  order.status = to;
  return copy(order);
}

// 장바구니의 상품으로 주문을 만든다. input = { address }
// 처리 순서: [검사 단계] 배송지 → 빈 장바구니 → 모든 상품 재고  →  [변경 단계] 재고 차감 · 주문 생성 · 장바구니 비우기
// 검사 단계에서는 저장소를 하나도 바꾸지 않는다. 이 함수는 동기 함수라 검사와 차감 사이에 다른 요청이 끼어들 수 없다.
function createOrder(ctx, userId, input = {}) {
  // ── 검사 단계 (저장소 변경 없음) ──────────────────────────────
  // 1) 배송지: 문자열이어야 하고, 공백 제거 후 비어 있으면 안 된다.
  const address = typeof input?.address === "string" ? input.address.trim() : "";
  if (address === "") {
    throw new AppError("INVALID_ADDRESS", "배송지를 입력해 주세요", {});
  }

  // 2) 빈 장바구니
  const cart = ctx.store.carts.get(userId);
  if (!cart || cart.size === 0) {
    throw new AppError("EMPTY_CART", "장바구니가 비어 있습니다", {});
  }

  // 3) 장바구니의 모든 상품 재고를 확인하고, 부족한 상품을 전부 모은다. (첫 부족에서 멈추지 않는다)
  const lines = [];
  const shortages = [];
  for (const [productId, quantity] of cart) {
    const product = ctx.store.products.get(productId);
    // 판매 중지 상품은 재고가 있어도 살 수 없으므로 available 을 0 으로 본다.
    const available = product && product.status === "ON_SALE" ? product.stock : 0;
    if (!product || quantity > available) {
      shortages.push({ productId, name: product ? product.name : productId, requested: quantity, available });
    } else {
      lines.push({ product, quantity });
    }
  }
  if (shortages.length > 0) {
    throw new AppError("OUT_OF_STOCK", "재고가 부족한 상품이 있습니다", { shortages });
  }

  // ── 변경 단계 (여기부터는 실패하지 않는다) ───────────────────────
  // 주문 시점의 상품명 · 단가를 복사해 둔다. 이후 상품 가격이 바뀌어도 주문은 바뀌지 않는다.
  const items = lines.map(({ product, quantity }) => ({
    productId: product.id,
    name: product.name,
    unitPrice: product.price,
    quantity,
  }));

  // 번호는 주문이 확정되는 이 시점에만 발급한다. (실패한 시도가 번호를 소모하지 않도록)
  ctx.store.seq.order += 1;
  const id = `ORD-${String(ctx.store.seq.order).padStart(4, "0")}`;

  for (const { product, quantity } of lines) {
    product.stock -= quantity;
  }

  const order = {
    id,
    userId,
    status: ORDER_STATUS.PENDING_PAYMENT,
    items,
    totalAmount: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    address,
    createdAt: ctx.clock.now().toISOString(),
  };
  ctx.store.orders.set(id, order);
  cart.clear(); // 주문이 만들어지면 장바구니를 비운다.

  return copy(order);
}

module.exports = { ORDER_STATUS, canTransition, changeStatus, createOrder };