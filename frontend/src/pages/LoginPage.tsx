import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { SplitCard } from "../components/layout/SplitCard"
import { Button } from "../components/ui/Button"
import { Field } from "../components/ui/Field"
import { useSession } from "../context/SessionContext"
import { login } from "../services/rooms"

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    // POST /api/auth/login: el back verifica contra el hash bcrypt y devuelve el JWT. El token
    // va dentro de la sesión y http.ts lo manda en cada petición (ver SessionContext).
    login(email, password)
      .then((result) => {
        signIn({ name: result.user.full_name, userId: result.user.id, token: result.token })
        navigate("/salas")
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.")
        setSubmitting(false)
      })
  }

  return (
    <SplitCard
      title="Presentá y compartí en tiempo real"
      text="Creá una sala, subí tu archivo en PDF o PowerPoint y mostralo a tu clase en vivo."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold text-brand-700">Iniciar sesión</h2>
        <Field label="Correo electrónico" type="email" autoComplete="email"
          placeholder="nombre@institucion.edu.ar" value={email}
          onChange={(event) => setEmail(event.target.value)} required />
        <Field label="Contraseña" type="password" autoComplete="current-password"
          placeholder="Ingresá tu contraseña" value={password}
          onChange={(event) => setPassword(event.target.value)} required />
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <Button type="submit" disabled={submitting}>{submitting ? "Ingresando…" : "Iniciar sesión"}</Button>
        <p className="text-sm text-ink/70">
          ¿No tenés cuenta?{" "}
          <Link to="/registro" className="font-semibold text-brand-500 hover:underline">Registrate</Link>
        </p>
      </form>
    </SplitCard>
  )
}
