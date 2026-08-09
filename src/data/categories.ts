export type ServiceCategory = {
  id: string
  name: string
  description: string
  icon: string
}

export const categories: ServiceCategory[] = [
  { id: 'plumbing', name: 'Plumbing', description: 'Leaks, fittings, drains', icon: 'pipe' },
  { id: 'electrical', name: 'Electrical', description: 'Wiring, switches, safety', icon: 'bolt' },
  { id: 'kitchen', name: 'Kitchen', description: 'Repairs & upgrades', icon: 'kitchen' },
  { id: 'appliances', name: 'Appliances', description: 'AC, fridge, washer, TV', icon: 'appliance' },
  { id: 'cleaning', name: 'Cleaning', description: 'Home deep cleans', icon: 'sparkle' },
  { id: 'painting', name: 'Painting', description: 'Interior & exterior', icon: 'paint' },
  { id: 'carpentry', name: 'Carpentry', description: 'Furniture & fittings', icon: 'hammer' },
  { id: 'pest', name: 'Pest control', description: 'Safe home treatment', icon: 'shield' },
  { id: 'purifier', name: 'Water purifier', description: 'Install & service', icon: 'droplet' },
  { id: 'chimney', name: 'Gas & chimney', description: 'Stove & hood care', icon: 'flame' },
  { id: 'maintenance', name: 'Maintenance', description: 'Indoor & outdoor', icon: 'wrench' },
  { id: 'gardening', name: 'Gardening', description: 'Lawn & plant care', icon: 'leaf' },
  { id: 'cctv', name: 'CCTV & security', description: 'Install & monitor', icon: 'camera' },
  { id: 'internet', name: 'Wi‑Fi setup', description: 'Routers & networks', icon: 'wifi' },
  { id: 'moving', name: 'Moving', description: 'Pack & shift', icon: 'truck' },
  { id: 'laundry', name: 'Laundry', description: 'Wash & fold', icon: 'shirt' },
  { id: 'beauty', name: 'Beauty at home', description: 'Wellness visits', icon: 'spa' },
  { id: 'care', name: 'Care services', description: 'Babysitting & elders', icon: 'heart' },
  { id: 'tuition', name: 'Home tuition', description: 'Teaching at home', icon: 'book' },
]

export const serviceOptions = categories.map((c) => c.name)
