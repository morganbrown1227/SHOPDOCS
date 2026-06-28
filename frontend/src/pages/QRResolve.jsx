import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";

export default function QRResolve() {
  const { code } = useParams();
  const nav = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/equipment/by-qr/${encodeURIComponent(code)}`);
        nav(`/equipment/${data.id}`, { replace: true });
      } catch (e) {
        nav(`/?qr_error=${encodeURIComponent(formatApiError(e))}`, { replace: true });
      }
    })();
  }, [code, nav]);
  return (
    <div className="p-10 label-caps" data-testid="qr-resolving">Looking up equipment…</div>
  );
}
