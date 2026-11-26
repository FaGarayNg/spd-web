import navbarLogo from "../../assets/navbar-logo.jpeg"

export function Brand() {
  return (
    <img
      src={navbarLogo}
      alt="S.P.D. — Sistema de Presentaciones Digital"
      className="h-9 w-auto max-w-[55vw] object-contain sm:h-10"
    />
  )
}
