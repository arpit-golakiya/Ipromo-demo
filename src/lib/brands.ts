import { dbQuery } from "@/lib/db";
import { ensureAuthTables, getAuthedUserOrNullFromCookies } from "@/lib/auth";

export type Brand = {
  id: string;
  ownerId: string;
  name: string;
  imageUrl: string;
  logoVariants: string[];
  isApproved: boolean;
  createdByEmail: string | null;
  createdAt: string;
};

export async function ensureBrandTables(): Promise<void> {
  // Ensure users table exists first (FK dependency).
  await ensureAuthTables();

  await dbQuery(`
    create table if not exists brands (
      id bigserial primary key,
      owner_id bigint not null references users(id) on delete cascade,
      name text not null,
      image_url text not null,
      created_at timestamptz not null default now()
    );
  `);

  // Migrations for existing installs.
  await dbQuery(`alter table brands add column if not exists logo_variants jsonb not null default '[]'::jsonb;`);
  await dbQuery(`alter table brands add column if not exists is_approved boolean not null default false;`);
  await dbQuery(`alter table brands add column if not exists created_by_email text;`);

  await dbQuery(`create index if not exists brands_owner_id_idx on brands(owner_id);`);
  await dbQuery(`create unique index if not exists brands_owner_name_uniq on brands(owner_id, name);`);
}

export async function requireAuthedUser() {
  const user = await getAuthedUserOrNullFromCookies();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function createBrandForUser(input: {
  ownerId: string;
  name: string;
  imageUrl: string;
  logoVariants?: string[];
  createdByEmail?: string | null;
}): Promise<Brand> {
  await ensureBrandTables();

  const name = input.name.trim();
  const imageUrl = input.imageUrl.trim();
  if (!name) throw new Error("Brand name is required");
  if (!imageUrl) throw new Error("Brand imageUrl is required");

  const variants = Array.isArray(input.logoVariants) ? input.logoVariants.filter((s) => typeof s === "string") : [];
  const createdByEmail = typeof input.createdByEmail === "string" ? input.createdByEmail.trim() : null;

  const { rows } = await dbQuery<{
    id: string;
    ownerId: string;
    name: string;
    imageUrl: string;
    logoVariants: unknown;
    isApproved: boolean;
    createdByEmail: string | null;
    createdAt: string;
  }>(
    `
    insert into brands (owner_id, name, image_url, logo_variants, is_approved, created_by_email)
    values ($1::bigint, $2, $3, $4::jsonb, $5, $6)
    returning id::text as id,
              owner_id::text as "ownerId",
              name,
              image_url as "imageUrl",
              logo_variants as "logoVariants",
              is_approved as "isApproved",
              created_by_email as "createdByEmail",
              created_at::text as "createdAt"
    `,
    [input.ownerId, name, imageUrl, JSON.stringify(variants), false, createdByEmail],
  );

  const row = rows[0];
  if (!row) throw new Error("Failed to create brand");
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    imageUrl: row.imageUrl,
    logoVariants: Array.isArray(row.logoVariants) ? (row.logoVariants as unknown[]).filter((x) => typeof x === "string") as string[] : [],
    isApproved: Boolean(row.isApproved),
    createdByEmail: row.createdByEmail ?? null,
    createdAt: row.createdAt,
  };
}

export async function listBrandsForUser(ownerId: string): Promise<Brand[]> {
  await ensureBrandTables();
  const { rows } = await dbQuery<{
    id: string;
    ownerId: string;
    name: string;
    imageUrl: string;
    logoVariants: unknown;
    isApproved: boolean;
    createdByEmail: string | null;
    createdAt: string;
  }>(
    `
    select id::text as id,
           owner_id::text as "ownerId",
           name,
           image_url as "imageUrl",
           logo_variants as "logoVariants",
           is_approved as "isApproved",
           created_by_email as "createdByEmail",
           created_at::text as "createdAt"
    from brands
    where owner_id = $1::bigint
    order by created_at desc
    `,
    [ownerId],
  );
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    imageUrl: r.imageUrl,
    logoVariants: Array.isArray(r.logoVariants) ? (r.logoVariants as unknown[]).filter((x) => typeof x === "string") as string[] : [],
    isApproved: Boolean(r.isApproved),
    createdByEmail: r.createdByEmail ?? null,
    createdAt: r.createdAt,
  }));
}

export async function getBrandForUser(input: { ownerId: string; brandId: string }): Promise<Brand | null> {
  await ensureBrandTables();
  const id = input.brandId.trim();
  if (!id) return null;
  const { rows } = await dbQuery<{
    id: string;
    ownerId: string;
    name: string;
    imageUrl: string;
    logoVariants: unknown;
    isApproved: boolean;
    createdByEmail: string | null;
    createdAt: string;
  }>(
    `
    select id::text as id,
           owner_id::text as "ownerId",
           name,
           image_url as "imageUrl",
           logo_variants as "logoVariants",
           is_approved as "isApproved",
           created_by_email as "createdByEmail",
           created_at::text as "createdAt"
    from brands
    where owner_id = $1::bigint
      and id::text = $2
    limit 1
    `,
    [input.ownerId, id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    imageUrl: r.imageUrl,
    logoVariants: Array.isArray(r.logoVariants)
      ? ((r.logoVariants as unknown[]).filter((x) => typeof x === "string") as string[])
      : [],
    isApproved: Boolean(r.isApproved),
    createdByEmail: r.createdByEmail ?? null,
    createdAt: r.createdAt,
  };
}

export async function updateBrandForUser(input: {
  ownerId: string;
  brandId: string;
  name?: string;
  imageUrl?: string;
  logoVariants?: string[];
  isApproved?: boolean;
}): Promise<Brand | null> {
  await ensureBrandTables();
  const id = input.brandId.trim();
  if (!id) return null;

  const name = typeof input.name === "string" ? input.name.trim() : undefined;
  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl.trim() : undefined;
  const variants = Array.isArray(input.logoVariants) ? input.logoVariants.filter((s) => typeof s === "string") : undefined;
  const variantsJson = variants ? JSON.stringify(variants) : null;
  const isApproved = typeof input.isApproved === "boolean" ? input.isApproved : undefined;

  const { rows } = await dbQuery<{
    id: string;
    ownerId: string;
    name: string;
    imageUrl: string;
    logoVariants: unknown;
    isApproved: boolean;
    createdByEmail: string | null;
    createdAt: string;
  }>(
    `
    update brands
    set name = coalesce($3, name),
        image_url = coalesce($4, image_url),
        logo_variants = coalesce($5::jsonb, logo_variants),
        is_approved = coalesce(
          $6::boolean,
          case when $5::jsonb is null then is_approved else false end
        )
    where owner_id = $1::bigint
      and id::text = $2
    returning id::text as id,
              owner_id::text as "ownerId",
              name,
              image_url as "imageUrl",
              logo_variants as "logoVariants",
              is_approved as "isApproved",
              created_by_email as "createdByEmail",
              created_at::text as "createdAt"
    `,
    [input.ownerId, id, name ?? null, imageUrl ?? null, variantsJson, isApproved ?? null],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    imageUrl: r.imageUrl,
    logoVariants: Array.isArray(r.logoVariants)
      ? ((r.logoVariants as unknown[]).filter((x) => typeof x === "string") as string[])
      : [],
    isApproved: Boolean(r.isApproved),
    createdByEmail: r.createdByEmail ?? null,
    createdAt: r.createdAt,
  };
}

export async function deleteBrandForUser(input: { ownerId: string; brandId: string }): Promise<boolean> {
  await ensureBrandTables();
  const id = input.brandId.trim();
  if (!id) return false;
  const { rowCount } = await dbQuery(
    `
    delete from brands
    where owner_id = $1::bigint
      and id::text = $2
    `,
    [input.ownerId, id],
  );
  return rowCount > 0;
}