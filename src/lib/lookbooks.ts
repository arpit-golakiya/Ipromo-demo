import { dbQuery } from "@/lib/db";
import { ensureBrandTables } from "@/lib/brands";

export type Lookbook = {
  id: string;
  ownerId: string;
  title: string;
  brandId: string;
  brandName: string;
  templateId: string;
  pdfUrl: string;
  previewUrl: string | null;
  createdByEmail: string | null;
  createdAt: string;
};

export async function ensureLookbookTables(): Promise<void> {
  await ensureBrandTables();

  await dbQuery(`
    create table if not exists lookbooks (
      id          bigserial primary key,
      owner_id    bigint not null references users(id) on delete cascade,
      title       text not null,
      brand_id    bigint not null,
      brand_name  text not null default '',
      template_id text not null,
      pdf_url     text not null,
      preview_url text,
      created_by_email text,
      created_at  timestamptz not null default now()
    );
  `);

  await dbQuery(`alter table lookbooks add column if not exists brand_name text not null default '';`);
  await dbQuery(`create index if not exists lookbooks_owner_id_idx on lookbooks(owner_id);`);
}

function rowToLookbook(r: {
  id: string;
  ownerId: string;
  title: string;
  brandId: string;
  brandName: string;
  templateId: string;
  pdfUrl: string;
  previewUrl: string | null;
  createdByEmail: string | null;
  createdAt: string;
}): Lookbook {
  return {
    id: r.id,
    ownerId: r.ownerId,
    title: r.title,
    brandId: r.brandId,
    brandName: r.brandName,
    templateId: r.templateId,
    pdfUrl: r.pdfUrl,
    previewUrl: r.previewUrl,
    createdByEmail: r.createdByEmail,
    createdAt: r.createdAt,
  };
}

const SELECT_COLS = `
  id::text           as id,
  owner_id::text     as "ownerId",
  title,
  brand_id::text     as "brandId",
  brand_name         as "brandName",
  template_id        as "templateId",
  pdf_url            as "pdfUrl",
  preview_url        as "previewUrl",
  created_by_email   as "createdByEmail",
  created_at::text   as "createdAt"
`;

export async function createLookbook(input: {
  ownerId: string;
  title: string;
  brandId: string;
  brandName: string;
  templateId: string;
  pdfUrl: string;
  previewUrl?: string | null;
  createdByEmail?: string | null;
}): Promise<Lookbook> {
  await ensureLookbookTables();

  const { rows } = await dbQuery<{
    id: string; ownerId: string; title: string; brandId: string; brandName: string;
    templateId: string; pdfUrl: string; previewUrl: string | null; createdByEmail: string | null; createdAt: string;
  }>(
    `
    insert into lookbooks (owner_id, title, brand_id, brand_name, template_id, pdf_url, preview_url, created_by_email)
    values ($1::bigint, $2, $3::bigint, $4, $5, $6, $7, $8)
    returning ${SELECT_COLS}
    `,
    [
      input.ownerId,
      input.title,
      input.brandId,
      input.brandName,
      input.templateId,
      input.pdfUrl,
      input.previewUrl ?? null,
      input.createdByEmail ?? null,
    ],
  );

  const row = rows[0];
  if (!row) throw new Error("Failed to create lookbook");
  return rowToLookbook(row);
}

export async function listLookbooksForUser(ownerId: string): Promise<Lookbook[]> {
  await ensureLookbookTables();

  const { rows } = await dbQuery<{
    id: string; ownerId: string; title: string; brandId: string; brandName: string;
    templateId: string; pdfUrl: string; previewUrl: string | null; createdByEmail: string | null; createdAt: string;
  }>(
    `
    select ${SELECT_COLS}
    from lookbooks
    where owner_id = $1::bigint
    order by created_at desc
    `,
    [ownerId],
  );

  return rows.map(rowToLookbook);
}

export async function getLookbookForUser(input: { ownerId: string; lookbookId: string }): Promise<Lookbook | null> {
  await ensureLookbookTables();

  const { rows } = await dbQuery<{
    id: string; ownerId: string; title: string; brandId: string; brandName: string;
    templateId: string; pdfUrl: string; previewUrl: string | null; createdByEmail: string | null; createdAt: string;
  }>(
    `
    select ${SELECT_COLS}
    from lookbooks
    where owner_id = $1::bigint
      and id::text = $2
    limit 1
    `,
    [input.ownerId, input.lookbookId],
  );

  return rows[0] ? rowToLookbook(rows[0]) : null;
}

export async function deleteLookbookForUser(input: { ownerId: string; lookbookId: string }): Promise<boolean> {
  await ensureLookbookTables();

  const { rowCount } = await dbQuery(
    `
    delete from lookbooks
    where owner_id = $1::bigint
      and id::text = $2
    `,
    [input.ownerId, input.lookbookId],
  );

  return rowCount > 0;
}
