import { useEffect, useRef, useState } from "react"
import { Link, Outlet, useNavigate } from "react-router-dom"
import { useSession } from "../../context/SessionContext"
import { initials } from "../../utils/initials"
import { Brand } from "../ui/Brand"
import { Icon } from "../ui/Icon"

export default function AppShell() {
  const { session, signOut } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // El menú se cierra al tocar afuera o con Escape.
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  const handleSignOut = () => {
    setOpen(false)
    signOut()
    navigate("/login")
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/salas" aria-label="Ir a mis salas">
            <Brand />
          </Link>
          {session && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex items-center gap-2.5 rounded-full border border-border py-1 pl-1 pr-4 text-sm font-medium hover:bg-brand-50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
                  {initials(session.name || "Invitado")}
                </span>
                {session.name || "Invitado"}
              </button>
              {open && (
                <div role="menu" className="absolute right-0 top-full z-10 mt-2 w-48 rounded-lg border border-border bg-surface p-1">
                  <button
                    role="menuitem"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-50"
                  >
                    <Icon name="logout" size={16} /> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}
