import { permanentRedirect } from "next/navigation";

export default function HardwareRedirectPage() {
  permanentRedirect("/compute");
}
