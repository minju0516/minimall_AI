// Mission 5 — 주문 조회 (SRS: FR-ORD-03 / US-09)
// ※ 이 파일은 "코딩 에이전트가 작성해 PR 로 올린 코드" 라고 가정한다. 팀은 리뷰어로서 이 코드를 검토한다.
const { findOwnedOrder } = require("./util");

function getOrderDetail(ctx, userId, orderId) {
  const order = findOwnedOrder(ctx, userId, orderId); // 본인 주문만. 없는 주문 · 남의 주문은 똑같이 NOT_FOUND
  const items = order.items.map((i) => {
    const unitPrice = i.unitPrice; // 주문 시점 단가 (현재 상품 가격을 보지 않는다)
    return { ...i, unitPrice, lineTotal: unitPrice * i.quantity };
  });
  return {
    id: order.id,
    status: order.status,
    createdAt: order.createdAt,
    address: order.address,
    items,
    totalAmount: items.reduce((s, i) => s + i.lineTotal, 0),
  };
}

function representativeName(order) {
  const first = order.items[0].name;
  return order.items.length > 1 ? `${first} 외 ${order.items.length - 1}건` : first;
}

function listOrders(ctx, userId, { page = 1, pageSize = 10 } = {}) {
  const mine = [...ctx.store.orders.values()]
    .filter((o) => o.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id.slice(4)) - Number(a.id.slice(4))); // 최신순, 같은 시각이면 번호 큰 것 먼저
  const start = (page - 1) * pageSize; // 페이지는 1부터 시작
  return {
    page,
    pageSize,
    total: mine.length,
    items: mine.slice(start, start + pageSize).map((o) => ({
      orderId: o.id,
      createdAt: o.createdAt,
      representativeName: representativeName(o),
      totalAmount: o.totalAmount,
      status: o.status,
    })),
  };
}

module.exports = { getOrderDetail, listOrders };