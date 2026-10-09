// Da Next 16 `eslint-config-next` esporta direttamente la configurazione
// «flat»: il ponte `FlatCompat` di prima non la sa più leggere.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  // next-env.d.ts lo genera Next a ogni build: non è codice nostro
  // `.next-pubblico` è la compilazione del pacchetto statico (vedi `distDir` in
  // next.config.ts): è uscita del compilatore come `.next`, e va ignorata per
  // la stessa ragione — dentro c'è JavaScript minificato, e lint su quello
  // produce centinaia di segnalazioni che non riguardano nessuno.
  // ogni cartella di compilazione: SITO_DIST_DIR può essere qualunque .next-*
  { ignores: [".next/**", ".next-*/**", "node_modules/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Le immagini restano `<img>` con width e height espliciti, non
      // `next/image`: §04 del piano disattiva l'ottimizzazione a richiesta
      // (le derivate sono già generate al caricamento e servite da Caddy), e
      // `next/image` aggiungerebbe JavaScript senza darci nulla in cambio.
      "@next/next/no-img-element": "off",

      // Le Server Action usate con `useActionState` hanno una firma imposta —
      // (statoPrecedente, formData) — e non sempre servono entrambi. Il codice
      // già segna con l'underscore i parametri che non usa: qui si dice alla
      // regola di fidarsi di quella convenzione invece di segnalarli.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // Regole nuove di `eslint-plugin-react-hooks` 7, arrivato con
      // `eslint-config-next` 16: servono a preparare il codice al React
      // Compiler, che qui non è acceso. Al passaggio a Next 16 segnalavano 16
      // punti in 8 file, tutti voluti — `Date.now()` nelle pagine dinamiche
      // dell'area, il «JavaScript è vivo» di barra e ricerca, un accumulatore
      // locale nei grafici — e nessun difetto. Restano spente come lo erano con
      // Next 15; rivederle è un lavoro a parte, da fare se si accende il
      // compilatore.
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
    },
  },
];

export default config;
