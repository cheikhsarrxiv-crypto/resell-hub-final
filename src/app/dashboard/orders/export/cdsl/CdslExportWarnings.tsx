/**
 * Pure presentational warning banners for the CDSL export review page —
 * split out of page.tsx so they can be rendered (and tested) without
 * page.tsx's own useSession()/useWorkspace() dependency, which needs a
 * real NextAuth SessionProvider context this project's test setup does
 * not provide (no @testing-library/react, no jsdom — see
 * src/components/ai/__tests__/agent-ui-rendering.test.tsx's own header
 * comment for the same constraint on component tests generally). Neither
 * component takes any prop that could leak real order/customer data.
 *
 * Both banners restate the same operational facts (this is a CSV
 * generator only, never a CDSL send/dispatch) because a user may act
 * right after seeing only one of the two — before deciding whether to
 * download, or after downloading and before manually emailing the file.
 */

const ICON_PATH =
  'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z';

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATH} />
    </svg>
  );
}

/** Shown persistently above the order list, before any download. */
export function CdslExportPreDownloadWarning() {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300"
    >
      <WarningIcon />
      <p>
        Le téléchargement génère uniquement un fichier CSV — <strong>aucune commande n&apos;est transmise à CDSL</strong>, envoyée
        ou marquée comme expédiée dans ADKSY. Un nouveau téléchargement peut inclure les mêmes commandes : transmettre deux fois
        le même fichier à CDSL créerait un doublon. Vérifiez le lot sélectionné et le contenu du fichier avant tout envoi manuel.
      </p>
    </div>
  );
}

export interface CdslExportPostDownloadWarningProps {
  exportedAtLabel: string;
  orderCount: number;
  filename: string;
}

/** Shown after a successful download, replacing/supplementing the plain success note. */
export function CdslExportPostDownloadWarning({ exportedAtLabel, orderCount, filename }: CdslExportPostDownloadWarningProps) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 sm:p-5 space-y-2">
      <p className="text-emerald-300 font-medium text-sm">
        Fichier généré le {exportedAtLabel} — {orderCount} commande(s) ({filename}).
      </p>
      <div role="alert" className="flex items-start gap-2 text-amber-300 text-xs">
        <WarningIcon />
        <p>
          Ce fichier n&apos;a pas été envoyé à CDSL et aucune commande n&apos;a été marquée comme envoyée ou expédiée dans ADKSY.
          Si vous relancez un export, les mêmes commandes peuvent y figurer à nouveau — transmettre deux fois le même lot à CDSL
          créerait un doublon. Vérifiez ce fichier avant de le transmettre manuellement à votre contact CDSL.
        </p>
      </div>
    </div>
  );
}
