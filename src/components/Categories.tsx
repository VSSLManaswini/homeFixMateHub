import { useCategories } from '../hooks/useCategories'
import { Icon } from './Icon'

type CategoriesProps = {
  onSelect: () => void
}

export function Categories({ onSelect }: CategoriesProps) {
  const { activeCategories, loading } = useCategories()

  return (
    <section className="section" id="categories">
      <div className="container">
        <div className="section-head">
          <h2>Every home service, one place</h2>
          <p>
            Start with a category — admins can add new ones anytime without redesigning the app.
          </p>
        </div>
        {loading && <p className="form-note">Loading categories…</p>}
        <div className="category-grid">
          {activeCategories.map((category) => (
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
