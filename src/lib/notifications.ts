import * as Notifications from 'expo-notifications'
import { DAY } from './inventory'
import type { AppState, Product } from '../types'

/** Request permission for notifications (call once on app start). */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') {
    const perm = await Notifications.requestPermissionsAsync()
    return perm.status === 'granted'
  }
  return true
}

/** Schedule a stock summary notification for items needing attention. */
export function scheduleStockSummary(s: AppState, now = Date.now()) {
  const items = stockItems(s)
  const attention = items.filter((p) => p.stock <= 0 || p.stock < 10)

  if (attention.length === 0) return

  const critical = attention.filter((p) => {
    const h = p.untracked ? 'healthy' : (p.composite && !p.recipe?.length ? 'setup' : 'out')
    return h === 'out' || h === 'critical'
  })

  const message = critical.length > 0
    ? `⚠️ ${critical.length} item(s) out of stock — restock immediately`
    : `Stock summary: ${attention.length} item(s) need attention`

  Notifications.scheduleNotificationAsync({
    content: {
      title: 'Stock Summary',
      body: message,
      data: { type: 'stock_summary' },
    },
    trigger: null, // show immediately
  })
}

/** Schedule a restock recommendation notification. */
export function scheduleRestockRecommendation(rec: { product: Product; health: string }, now = Date.now()) {
  const { product, health } = rec
  const unit = product.unitPlural || 'items'

  let body: string
  if (health === 'critical') {
    body = `🚨 ${product.name}: ${product.stock} ${unit} left — critical, restock now`
  } else if (health === 'low') {
    const cover = product.stock > 0 ? /* daysCover would go here */ '1 day' : 'out'
    body = `⚠️ ${product.name}: low stock (${product.stock} ${unit}) — consider restocking`
  } else {
    return // healthy items don't need alerts
  }

  Notifications.scheduleNotificationAsync({
    content: {
      title: 'Restock Recommendation',
      body,
      data: { type: 'restock', productId: product.id },
    },
    trigger: null,
  })
}