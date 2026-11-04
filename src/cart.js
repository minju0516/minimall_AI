// Mission 1 — 장바구니 (SRS: FR-CART-01, FR-CART-02 / US-05, US-06)
// 계약(입력 · 출력 · 오류 코드)은 docs/API_CONTRACT.md 의 "1. 장바구니" 를 읽는다.
const { AppError } = require("./errors");

const MAX_QTY = 99;

// 장바구니에 상품을 담는다. 이미 담긴 상품이면 수량을 합산한다. 담은 뒤의 장바구니(getCart 형식)를 돌려준다.
function addToCart(ctx, userId, productId, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
    throw new AppError("INVALID_QUANTITY", "수량은 1~99 사이의 정수여야 합니다", {
      quantity,
    });
  }

  const product = ctx.store.products.get(productId);
  if (!product || product.status !== "ON_SALE") {
    throw new AppError("NOT_FOUND", "상품을 찾을 수 없습니다", { productId });
  }

  const existingCart = ctx.store.carts.get(userId);
  const existingQuantity = existingCart ? existingCart.get(productId) || 0 : 0;
  const requestedQuantity = existingQuantity + quantity;

  if (requestedQuantity > product.stock) {
    throw new AppError("OUT_OF_STOCK", "재고가 부족합니다", {
      productId,
      maxAddable: Math.max(0, product.stock - existingQuantity),
    });
  }

  const cart = existingCart || new Map();
  cart.set(productId, requestedQuantity);
  if (!existingCart) {
    ctx.store.carts.set(userId, cart);
  }

  return getCart(ctx, userId);
}

// 담긴 상품의 수량을 quantity 로 바꾼다. 바뀐 장바구니를 돌려준다.
function changeQuantity(ctx, userId, productId, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
    throw new AppError("INVALID_QUANTITY", "수량은 1~99 사이의 정수여야 합니다", {
      quantity,
    });
  }

  const cart = ctx.store.carts.get(userId);
  if (!cart || !cart.has(productId)) {
    throw new AppError("NOT_FOUND", "장바구니 상품을 찾을 수 없습니다", {
      productId,
    });
  }

  const product = ctx.store.products.get(productId);
  if (!product || product.status !== "ON_SALE") {
    throw new AppError("NOT_FOUND", "상품을 찾을 수 없습니다", { productId });
  }

  if (quantity > product.stock) {
    throw new AppError("OUT_OF_STOCK", "재고가 부족합니다", {
      productId,
      maxAddable: Math.max(0, product.stock),
    });
  }

  cart.set(productId, quantity);
  return getCart(ctx, userId);
}

// 담긴 상품을 장바구니에서 뺀다. 바뀐 장바구니를 돌려준다.
function removeItem(ctx, userId, productId) {
  const cart = ctx.store.carts.get(userId);
  if (!cart || !cart.has(productId)) {
    throw new AppError("NOT_FOUND", "장바구니 상품을 찾을 수 없습니다", {
      productId,
    });
  }

  cart.delete(productId);
  return getCart(ctx, userId);
}

// 장바구니를 { userId, items: [{ productId, name, unitPrice, quantity, lineTotal }], totalAmount } 형식으로 돌려준다.
function getCart(ctx, userId) {
  const cart = ctx.store.carts.get(userId);
  const items = [];
  let totalAmount = 0;

  if (cart) {
    for (const [productId, quantity] of cart) {
      const product = ctx.store.products.get(productId);
      const lineTotal = product.price * quantity;

      items.push({
        productId,
        name: product.name,
        unitPrice: product.price,
        quantity,
        lineTotal,
      });
      totalAmount += lineTotal;
    }
  }

  return { userId, items, totalAmount };
}

module.exports = { addToCart, changeQuantity, removeItem, getCart, MAX_QTY };
