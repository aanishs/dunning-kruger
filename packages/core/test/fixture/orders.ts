import { clamp, formatMoney } from "./util";

interface Order {
  items: { price: number; qty: number }[];
  discount?: number;
}

export function priceOrder(order: Order | null): string {
  if (!order) return formatMoney(0);
  const sub = order.items.reduce((s, it) => s + it.price * it.qty, 0);
  const discounted = order.discount ? sub - order.discount : sub;
  const total = clamp(discounted, 0, 1_000_000);
  return formatMoney(total);
}

export function summarize(order: Order | null): string {
  const price = priceOrder(order);
  const count = order ? order.items.length : 0;
  return `${count} item(s), total ${price}`;
}
