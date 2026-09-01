import { Router } from "express";
import { sql } from "../supabaseClient.js";
import { requireAuth, requireRole } from "../auth.js";
import { rolesForModule } from "../../public/src/roles.js";
import { asyncHandler, HttpError, nn, prepInsert } from "../utils.js";

export const fornecedoresRouter = Router();
fornecedoresRouter.use(requireAuth);
fornecedoresRouter.use(requireRole(...rolesForModule("fornecedores")));

function pick(body) {
  const data = {
    name: nn(body?.name),
    document: nn(body?.document),
    category: nn(body?.category),
    email: nn(body?.email),
    phone: nn(body?.phone),
    notes: nn(body?.notes),
  };
  if (!data.name) throw new HttpError(400, "Informe o nome do fornecedor.");
  return data;
}

// GET /api/fornecedores
fornecedoresRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await sql`
      select s.*,
        (select count(*)::int from "SupplierProduct" sp where sp."supplierId" = s.id) as products
      from "Supplier" s order by s.name asc`;
    res.json(rows);
  }),
);

// GET /api/fornecedores/:id — com itens fornecidos.
fornecedoresRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [supplier] = await sql`select * from "Supplier" where id = ${req.params.id}`;
    if (!supplier) throw new HttpError(404, "Fornecedor não encontrado.");
    const products = await sql`
      select sp.id, sp."costCents", sp."isDefault", p.id as "productId", p.name, p.unit
      from "SupplierProduct" sp
      join "ProductService" p on p.id = sp."productServiceId"
      where sp."supplierId" = ${supplier.id}
      order by sp."isDefault" desc, p.name asc`;
    res.json({ ...supplier, products });
  }),
);

// POST /api/fornecedores
fornecedoresRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = prepInsert(pick(req.body));
    const [created] = await sql`insert into "Supplier" ${sql(data)} returning *`;
    res.status(201).json(created);
  }),
);

// PUT /api/fornecedores/:id
fornecedoresRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = pick(req.body);
    const [updated] = await sql`
      update "Supplier" set ${sql(data)}, "updatedAt" = now()
      where id = ${req.params.id} returning *`;
    if (!updated) throw new HttpError(404, "Fornecedor não encontrado.");
    res.json(updated);
  }),
);

// DELETE /api/fornecedores/:id
fornecedoresRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const [deleted] = await sql`delete from "Supplier" where id = ${req.params.id} returning id`;
      if (!deleted) throw new HttpError(404, "Fornecedor não encontrado.");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "23503")
        throw new HttpError(
          409,
          "Não é possível excluir: este fornecedor está vinculado a itens do catálogo ou contas a pagar.",
        );
      throw e;
    }
  }),
);
