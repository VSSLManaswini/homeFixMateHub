import { useRef, useState } from 'react'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { RoleGate, type Role } from './components/RoleGate'
import { Categories } from './components/Categories'
import { Features } from './components/Features'
import { HowItWorks } from './components/HowItWorks'
import { Footer, FooterCta } from './components/Footer'
import { useTheme } from './hooks/useTheme'

function App() {
  const { theme, toggleTheme } = useTheme()
  const [role, setRole] = useState<Role>(null)
  const roleSectionRef = useRef<HTMLDivElement>(null)

  const scrollToGetStarted = (nextRole?: Role) => {
    if (nextRole) setRole(nextRole)
    document.getElementById('get-started')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        onGetStarted={() => scrollToGetStarted()}
      />
      <main ref={roleSectionRef}>
        <Hero onGetStarted={() => scrollToGetStarted()} />
        <RoleGate role={role} onRoleChange={setRole} />
        <Categories onSelect={() => scrollToGetStarted('receiver')} />
        <HowItWorks />
        <Features />
        <FooterCta onGetStarted={() => scrollToGetStarted()} />
      </main>
      <Footer />
    </>
  )
}

export default App
