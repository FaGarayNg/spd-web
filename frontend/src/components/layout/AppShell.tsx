import { useEffect, useRef, useState } from "react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useSession } from "../../context/SessionContext"
import { initials } from "../../utils/initials"
import { Brand } from "../ui/Brand"
import { Icon } from "../ui/Icon"

export default function AppShell() {
  const { session, signOut } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // El visor en vivo ocupa toda la pantalla en el celular: sin el ancho máximo ni el
  // padding del resto de las páginas.
  const isLive = /^\/salas\/[^/]+\/en-vivo\/?$/.test(location.pathname)

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
      <header className={`border-b border-border bg-surface ${isLive ? "hidden sm:block" : ""}`}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/salas" aria-label="Ir a mis salas">
            <Brand />
          </Link>
          {session && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex min-w-0 items-center gap-2.5 rounded-full border border-border py-1 pl-1 pr-3 text-sm font-medium hover:bg-brand-50 sm:pr-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
                  {initials(session.name || "Usuario")}
                </span>
                <span className="max-w-[38vw] truncate sm:max-w-none">{session.name || "Usuario"}</span>
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
      <main className={isLive ? "w-full p-0 sm:px-6 sm:py-6" : "mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10"}>
        <Outlet />
      </main>
    </div>
  )
}
