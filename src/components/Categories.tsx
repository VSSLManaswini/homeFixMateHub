import { categories } from '../data/categories'
import { Icon } from './Icon'

type CategoriesProps = {
  onSelect: () => void
}

export function Categories({ onSelect }: CategoriesProps) {
  return (
    <section className="section" id="categories">
      <div className="container">
        <div className="section-head">
          <h2>Every home service, one place</h2>
          <p>
            Start with a category — new ones can be added anytime from the admin panel without redesigning the app.
          </p>
        </div>
        <div className="category-grid">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className="category-item"
              onClick={onSelect}
            >
              <span className="category-icon">
                <Icon name={category.icon} />
              </span>
              <strong>{category.name}</strong>
              <span>{category.description}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
