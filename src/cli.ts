#!/usr/bin/env node
import { ingest } from "./stages/ingest.js";
import { buildCards } from "./stages/build-cards.js";
import { extract } from "./stages/extract.js";
import { verify } from "./stages/verify.js";
import { enrich } from "./stages/enrich.js";
import { buildWeb } from "./stages/build-web.js";
import { deploy } from "./stages/deploy.js";
import { proposal } from "./stages/proposal.js";
import { pkg } from "./stages/package.js";

type Flags = Record<string, string | boolean>;

interface ParsedArgs {
  positionals: string[];
  flags: Flags;
}

/** Parser minimo: separa positionals de --flag / --flag=valor / --flag (boolean). */
function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function asString(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

const USAGE = `card-leads — pipeline tarjeta -> digital cards + web

Uso:
  cli ingest <front> [back] [--slug s] [--rubro r] [--channel c] [--force]
  cli build-cards <slug>
  cli extract <slug>
  cli verify <slug>           (checkpoint humano interactivo)
  cli enrich <slug>           (genera copy de marketing con IA)
  cli build-web <slug>        (stub)
  cli deploy <slug>
  cli proposal <slug>         (stub)
  cli package <slug>          (mensaje de contacto para WhatsApp)

Rubros: doctor, barberia, estetica, veterinario, nutriologo, otro
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);

  switch (cmd) {
    case "ingest": {
      const lead = await ingest({
        front: positionals[0]!,
        back: positionals[1],
        slug: asString(flags.slug),
        rubro: asString(flags.rubro),
        channel: asString(flags.channel),
        force: flags.force === true || flags.force === "true",
      });
      console.log(`ingested: ${lead.slug} (rubro=${lead.rubro}, status=${lead.status})`);
      if (lead.meta.needs.length) {
        console.log("  pendiente:");
        for (const n of lead.meta.needs) console.log(`   - ${n}`);
      }
      break;
    }

    case "build-cards": {
      const out = await buildCards(positionals[0]!);
      console.log(`digital cards escritas:`);
      for (const p of out) console.log(`  - ${p}`);
      break;
    }

    case "extract": {
      const lead = await extract(positionals[0]!);
      console.log(`extracted: ${lead.slug} (rubro=${lead.rubro}, status=${lead.status})`);
      console.log(`  negocio: ${lead.business.name || "(sin nombre)"}`);
      if (lead.meta.needs.length) {
        console.log("  pendiente (revision humana):");
        for (const n of lead.meta.needs) console.log(`   - ${n}`);
      }
      break;
    }
    case "verify": {
      const lead = await verify(positionals[0]!);
      if (!lead) break; // cancelado: verify ya explico, el lead sigue en "extracted"
      console.log(`\nverified: ${lead.slug} (status=${lead.status})`);
      if (lead.meta.needs.length) {
        console.log("  pendiente todavia:");
        for (const n of lead.meta.needs) console.log(`   - ${n}`);
      } else {
        console.log("  sin pendientes: datos completos.");
      }
      break;
    }
    case "enrich": {
      const lead = await enrich(positionals[0]!);
      console.log(`enriched: ${lead.slug} (status=${lead.status})`);
      const copy = lead.content.generated_copy;
      if (copy) {
        console.log(`  headline: ${copy.hero_headline}`);
        console.log(
          `  bloques: ${copy.value_props.length} value props, ${copy.faqs.length} FAQs, ` +
            `${copy.testimonials.length} testimonios, ${copy.service_descriptions.length} servicios con descripcion`,
        );
      }
      if (lead.meta.needs.length) {
        console.log("  pendiente (revision humana):");
        for (const n of lead.meta.needs) console.log(`   - ${n}`);
      }
      break;
    }
    case "build-web": {
      const out = await buildWeb(positionals[0]!);
      console.log(`web escrita: ${out}`);
      break;
    }
    case "deploy": {
      const lead = await deploy(positionals[0]!);
      console.log(`deployed: ${lead.slug} (status=${lead.status})`);
      if (lead.generated.dc_url) console.log(`  dc:  ${lead.generated.dc_url}`);
      if (lead.generated.web_url) console.log(`  web: ${lead.generated.web_url}`);
      break;
    }
    case "proposal":
      await proposal(positionals[0]!);
      break;
    case "package": {
      const { lead, message } = await pkg(positionals[0]!);
      console.log(`mensaje de contacto listo: ${lead.slug} (status=${lead.status})`);
      console.log("\n── Mensaje de apertura (front) ──\n");
      console.log(message.front);
      console.log("\n── Mensaje de seguimiento (back) ──\n");
      console.log(message.back);
      console.log(
        "\n(Guardado en generated.outreach_message. Envíalo junto con una captura de la tarjeta digital.)",
      );
      break;
    }

    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      break;

    default:
      console.error(`Comando desconocido: "${cmd}"\n`);
      console.error(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
