import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert, toCents } from "../utils.js";

export const catalogoRouter = Router();
catalogoRouter.use(requireAuth);
catalogoRouter.use(requireRole(...rolesForModule("fornecedores")));

function pickProduct(body) {
  const data = {
    name: nn(body?.name),
    description: nn(body?.description),
    categoryId: nn(body?.categoryId),
    unit: nn(body?.unit),
    referenceCostCents: toCents(body?.referenceCost),
    suggestedPriceCents: toCents(body?.suggestedPrice),
    active: body?.active !== false && body?.active !== "false",
  };
  if (!data.name) throw new HttpError(400, "Informe o nome do produto/serviço.");
  return data;
}

// ---- Produtos / serviços ----

// GET /api/catalogo
catalogoRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select p.*, c.name as "categoryName",
        (select count(*)::int from "SupplierProduct" sp where sp."productServiceId" = p.id) as suppliers
      from "ProductService" p
      left join "Category" c on c.id = p."categoryId"
      order by p.name asc`;
    res.json(rows);
  }),
);

// GET /api/catalogo/categorias
catalogoRouter.get(
  "/categorias",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select c.*, (select count(*)::int from "ProductService" p where p."categoryId" = c.id) as products
      from "Category" c order by c.name asc`;
    res.json(rows);
  }),
);

// POST /api/catalogo/categorias
catalogoRouter.post(
  "/categorias",
  asyncHandler(async (req, res) => {
    const name = nn(req.body?.name);
    if (!name) throw new HttpError(400, "Informe o nome da categoria.");
    try {
      const data = prepInsert({ name }, { updatedAt: false });
      delete data.createdAt; // Category não tem createdAt
      const [created] = await sql`insert into "Category" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23505") throw new HttpError(400, "Já existe uma categoria com esse nome.");
      throw e;
    }
  }),
);

// DELETE /api/catalogo/categorias/:id
catalogoRouter.delete(
  "/categorias/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "Category" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Categoria não encontrada.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(409, "Não é possível excluir: existem produtos/serviços nesta categoria.");
      throw e;
    }
  }),
);

// GET /api/catalogo/:id — com fornecedores vinculados.
catalogoRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [product] = await sql`
      select p.*, c.name as "categoryName"
      from "ProductService" p
      left join "Category" c on c.id = p."categoryId"
      where p.id = ${req.params.id}`;
    if (!product) throw new HttpError(404, "Item não encontrado.");
    const suppliers = await sql`
      select sp.id, sp."costCents", sp."isDefault", s.id as "supplierId", s.name
      from "SupplierProduct" sp
      join "Supplier" s on s.id = sp."supplierId"
      where sp."productServiceId" = ${product.id}
      order by sp."isDefault" desc, sp."costCents" asc`;
    res.json({ ...product, suppliers });
  }),
);

// POST /api/catalogo
catalogoRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = prepInsert(pickProduct(req.body));
    try {
      const [created] = await sql`insert into "ProductService" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Categoria selecionada não existe mais.");
      throw e;
    }
  }),
);

// PUT /api/catalogo/:id
catalogoRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pickProduct(req.body);
    try {
      const [updated] = await sql`
        update "ProductService" set ${sql(data)}, "updatedAt" = now()
        where id = ${req.params.id} returning *`;
      if (!updated) throw new HttpError(404, "Item não encontrado.");
      res.json(updated);
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(400, "Categoria selecionada não existe mais.");
      throw e;
    }
  }),
);

// DELETE /api/catalogo/:id
catalogoRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "ProductService" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Item não encontrado.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(
          409,
          "Não é possível excluir: este item está vinculado a fornecedores ou a itens de orçamento. Desative-o em vez de excluir.",
        );
      throw e;
    }
  }),
);

// ---- Vínculo fornecedor ↔ item ----

// POST /api/catalogo/:id/fornecedores
catalogoRouter.post(
  "/:id/fornecedores",
  asyncHandler(async (req, res) => {
    const supplierId = nn(req.body?.supplierId);
    if (!supplierId) throw new HttpError(400, "Selecione um fornecedor.");
    const isDefault = req.body?.isDefault === true || req.body?.isDefault === "true";

    if (isDefault) {
      await sql`
        update "SupplierProduct" set "isDefault" = false
        where "productServiceId" = ${req.params.id}`;
    }
    try {
      const data = prepInsert({
        productServiceId: req.params.id,
        supplierId,
        costCents: toCents(req.body?.cost),
        isDefault,
      }, { updatedAt: false });
      delete data.createdAt; // SupplierProduct não tem createdAt
      const [created] = await sql`insert into "SupplierProduct" ${sql(data)} returning *`;
      res.status(201).json(created);
    } catch (e) {
      if (e.code === "23505") throw new HttpError(400, "Esse fornecedor já está vinculado a este item.");
      if (e.code === "23503")
        throw new HttpError(400, "Fornecedor ou item do catálogo selecionado não existe mais.");
      throw e;
    }
  }),
);

// DELETE /api/catalogo/fornecedores/:linkId
catalogoRouter.delete(
  "/fornecedores/:linkId",
  asyncHandler(async (req, res) => {
    const [deleted] = await sql`delete from "SupplierProduct" where id = ${req.params.linkId} returning id`;
    if (!deleted) throw new HttpError(404, "Vínculo não encontrado.");
    res.json({ ok: true });
  }),
);
