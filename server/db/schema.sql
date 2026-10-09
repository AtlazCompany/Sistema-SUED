--
-- PostgreSQL database dump
--

\restrict bCL4hi4icVyWreJzHhPvrLSV6AfvDU31PUOPa8YCmdtfXQV4FUWoWe5Ta3ZNzx1

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AccountPayable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AccountPayable" (
    id uuid NOT NULL,
    description text NOT NULL,
    "eventId" uuid,
    "supplierId" uuid,
    "amountCents" integer DEFAULT 0 NOT NULL,
    "dueDate" date,
    status text DEFAULT 'PENDENTE'::text NOT NULL,
    "paidDate" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "isTax" boolean DEFAULT false NOT NULL
);


--
-- Name: AccountReceivable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AccountReceivable" (
    id uuid NOT NULL,
    description text NOT NULL,
    "eventId" uuid,
    "amountCents" integer DEFAULT 0 NOT NULL,
    "dueDate" date,
    status text DEFAULT 'PENDENTE'::text NOT NULL,
    "receivedDate" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "taxRatePercent" integer DEFAULT 0 NOT NULL
);


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditLog" (
    id uuid NOT NULL,
    "table" text NOT NULL,
    "recordId" uuid NOT NULL,
    action text NOT NULL,
    "userId" uuid,
    "userName" text NOT NULL,
    before jsonb,
    after jsonb,
    "createdAt" timestamp with time zone NOT NULL
);


--
-- Name: Budget; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Budget" (
    id uuid NOT NULL,
    number text NOT NULL,
    "clientId" uuid,
    "eventId" uuid,
    "opportunityId" uuid,
    status text DEFAULT 'RASCUNHO'::text NOT NULL,
    "validUntil" date,
    "discountCents" integer DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    vigente boolean DEFAULT false NOT NULL,
    "taxRatePercent" integer DEFAULT 0 NOT NULL
);


--
-- Name: BudgetItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BudgetItem" (
    id uuid NOT NULL,
    "budgetId" uuid NOT NULL,
    "productServiceId" uuid,
    description text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    "unitPriceCents" integer DEFAULT 0 NOT NULL,
    "unitCostCents" integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: Budget_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Budget_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Category" (
    id uuid NOT NULL,
    name text NOT NULL
);


--
-- Name: Checklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Checklist" (
    id uuid NOT NULL,
    "eventId" uuid NOT NULL,
    title text NOT NULL
);


--
-- Name: ChecklistItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ChecklistItem" (
    id uuid NOT NULL,
    "checklistId" uuid NOT NULL,
    label text NOT NULL,
    done boolean DEFAULT false NOT NULL,
    "doneAt" timestamp with time zone,
    "order" integer DEFAULT 0
);


--
-- Name: Client; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Client" (
    id uuid NOT NULL,
    "personType" text DEFAULT 'PF'::text NOT NULL,
    name text NOT NULL,
    "tradeName" text,
    document text,
    email text,
    phone text,
    "zipCode" text,
    street text,
    number text,
    complement text,
    district text,
    city text,
    state text,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: Contact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Contact" (
    id uuid NOT NULL,
    "clientId" uuid NOT NULL,
    name text NOT NULL,
    "primary" boolean DEFAULT false NOT NULL
);


--
-- Name: Contract; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Contract" (
    id uuid NOT NULL,
    number text NOT NULL,
    "clientId" uuid,
    "eventId" uuid,
    status text DEFAULT 'RASCUNHO'::text NOT NULL,
    "valueCents" integer DEFAULT 0 NOT NULL,
    content text,
    "signedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    vigente boolean DEFAULT false NOT NULL
);


--
-- Name: Contract_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Contract_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Event" (
    id uuid NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'RASCUNHO'::text NOT NULL,
    "clientId" uuid,
    "eventTypeId" uuid,
    "venueId" uuid,
    "opportunityId" uuid,
    "commercialId" uuid,
    "operationalId" uuid,
    "eventDate" date,
    "startTime" time without time zone,
    "endTime" time without time zone,
    "guestCount" integer,
    "plannedRevenueCents" integer DEFAULT 0 NOT NULL,
    "actualRevenueCents" integer DEFAULT 0 NOT NULL,
    "plannedCostCents" integer DEFAULT 0 NOT NULL,
    "actualCostCents" integer DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: EventType; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EventType" (
    id uuid NOT NULL,
    name text NOT NULL
);


--
-- Name: Interaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Interaction" (
    id uuid NOT NULL,
    type text DEFAULT 'NOTA'::text NOT NULL,
    content text NOT NULL,
    "opportunityId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);


--
-- Name: Lead; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Lead" (
    id uuid NOT NULL,
    name text NOT NULL,
    company text,
    email text,
    phone text,
    source text,
    status text DEFAULT 'NOVO'::text NOT NULL,
    notes text,
    "clientId" uuid,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: Opportunity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Opportunity" (
    id uuid NOT NULL,
    title text NOT NULL,
    "clientId" uuid NOT NULL,
    "ownerId" uuid,
    stage text DEFAULT 'PROSPECCAO'::text NOT NULL,
    "estimatedCents" integer DEFAULT 0 NOT NULL,
    "expectedDate" date,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: ProductService; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProductService" (
    id uuid NOT NULL,
    name text NOT NULL,
    description text,
    "categoryId" uuid,
    unit text,
    "referenceCostCents" integer DEFAULT 0 NOT NULL,
    "suggestedPriceCents" integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: ScheduleItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ScheduleItem" (
    id uuid NOT NULL,
    "eventId" uuid NOT NULL,
    title text NOT NULL,
    "startsAt" timestamp with time zone NOT NULL,
    "endsAt" timestamp with time zone,
    location text,
    notes text
);


--
-- Name: Supplier; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Supplier" (
    id uuid NOT NULL,
    name text NOT NULL,
    document text,
    category text,
    email text,
    phone text,
    notes text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: SupplierProduct; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupplierProduct" (
    id uuid NOT NULL,
    "productServiceId" uuid NOT NULL,
    "supplierId" uuid NOT NULL,
    "costCents" integer DEFAULT 0 NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL
);


--
-- Name: Task; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Task" (
    id uuid NOT NULL,
    "eventId" uuid NOT NULL,
    title text NOT NULL,
    description text,
    "assigneeId" uuid,
    status text DEFAULT 'A_FAZER'::text NOT NULL,
    priority text DEFAULT 'MEDIA'::text NOT NULL,
    "dueDate" date,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: Transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Transaction" (
    id uuid NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    "amountCents" integer NOT NULL,
    date timestamp with time zone NOT NULL,
    "eventId" uuid,
    "receivableId" uuid,
    "payableId" uuid,
    "taxReserveCents" integer DEFAULT 0 NOT NULL,
    "isTax" boolean DEFAULT false NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "passwordHash" text NOT NULL,
    "tokenVersion" integer DEFAULT 0 NOT NULL,
    "resetTokenHash" text,
    "resetTokenExpiresAt" timestamp with time zone
);


--
-- Name: Venue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Venue" (
    id uuid NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    state text,
    capacity integer,
    "isOwn" boolean DEFAULT false NOT NULL,
    notes text,
    "createdAt" timestamp with time zone NOT NULL
);


--
-- Name: AccountPayable AccountPayable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccountPayable"
    ADD CONSTRAINT "AccountPayable_pkey" PRIMARY KEY (id);


--
-- Name: AccountReceivable AccountReceivable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccountReceivable"
    ADD CONSTRAINT "AccountReceivable_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: BudgetItem BudgetItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BudgetItem"
    ADD CONSTRAINT "BudgetItem_pkey" PRIMARY KEY (id);


--
-- Name: Budget Budget_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Budget"
    ADD CONSTRAINT "Budget_number_key" UNIQUE (number);


--
-- Name: Budget Budget_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Budget"
    ADD CONSTRAINT "Budget_pkey" PRIMARY KEY (id);


--
-- Name: Category Category_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_name_key" UNIQUE (name);


--
-- Name: Category Category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_pkey" PRIMARY KEY (id);


--
-- Name: ChecklistItem ChecklistItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChecklistItem"
    ADD CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY (id);


--
-- Name: Checklist Checklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checklist"
    ADD CONSTRAINT "Checklist_pkey" PRIMARY KEY (id);


--
-- Name: Client Client_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Client"
    ADD CONSTRAINT "Client_pkey" PRIMARY KEY (id);


--
-- Name: Contact Contact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contact"
    ADD CONSTRAINT "Contact_pkey" PRIMARY KEY (id);


--
-- Name: Contract Contract_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_number_key" UNIQUE (number);


--
-- Name: Contract Contract_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_pkey" PRIMARY KEY (id);


--
-- Name: EventType EventType_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EventType"
    ADD CONSTRAINT "EventType_pkey" PRIMARY KEY (id);


--
-- Name: Event Event_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_code_key" UNIQUE (code);


--
-- Name: Event Event_opportunityId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_opportunityId_key" UNIQUE ("opportunityId");


--
-- Name: Event Event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_pkey" PRIMARY KEY (id);


--
-- Name: Interaction Interaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Interaction"
    ADD CONSTRAINT "Interaction_pkey" PRIMARY KEY (id);


--
-- Name: Lead Lead_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Lead"
    ADD CONSTRAINT "Lead_pkey" PRIMARY KEY (id);


--
-- Name: Opportunity Opportunity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Opportunity"
    ADD CONSTRAINT "Opportunity_pkey" PRIMARY KEY (id);


--
-- Name: ProductService ProductService_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductService"
    ADD CONSTRAINT "ProductService_pkey" PRIMARY KEY (id);


--
-- Name: ScheduleItem ScheduleItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ScheduleItem"
    ADD CONSTRAINT "ScheduleItem_pkey" PRIMARY KEY (id);


--
-- Name: SupplierProduct SupplierProduct_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupplierProduct"
    ADD CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY (id);


--
-- Name: SupplierProduct SupplierProduct_productServiceId_supplierId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupplierProduct"
    ADD CONSTRAINT "SupplierProduct_productServiceId_supplierId_key" UNIQUE ("productServiceId", "supplierId");


--
-- Name: Supplier Supplier_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Supplier"
    ADD CONSTRAINT "Supplier_pkey" PRIMARY KEY (id);


--
-- Name: Task Task_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Task"
    ADD CONSTRAINT "Task_pkey" PRIMARY KEY (id);


--
-- Name: Transaction Transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_pkey" PRIMARY KEY (id);


--
-- Name: User User_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_email_key" UNIQUE (email);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Venue Venue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Venue"
    ADD CONSTRAINT "Venue_pkey" PRIMARY KEY (id);


--
-- Name: AccountReceivable_dueDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccountReceivable_dueDate_idx" ON public."AccountReceivable" USING btree ("dueDate");


--
-- Name: AccountReceivable_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccountReceivable_status_idx" ON public."AccountReceivable" USING btree (status);


--
-- Name: AuditLog_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_createdAt_idx" ON public."AuditLog" USING btree ("createdAt");


--
-- Name: AuditLog_table_recordId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_table_recordId_idx" ON public."AuditLog" USING btree ("table", "recordId");


--
-- Name: AuditLog_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_userId_idx" ON public."AuditLog" USING btree ("userId");


--
-- Name: BudgetItem_budgetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BudgetItem_budgetId_idx" ON public."BudgetItem" USING btree ("budgetId");


--
-- Name: BudgetItem_budgetId_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BudgetItem_budgetId_position_idx" ON public."BudgetItem" USING btree ("budgetId", "position");


--
-- Name: Budget_eventId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Budget_eventId_idx" ON public."Budget" USING btree ("eventId");


--
-- Name: ChecklistItem_checklistId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ChecklistItem_checklistId_idx" ON public."ChecklistItem" USING btree ("checklistId");


--
-- Name: Checklist_eventId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Checklist_eventId_idx" ON public."Checklist" USING btree ("eventId");


--
-- Name: Client_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Client_document_idx" ON public."Client" USING btree (document);


--
-- Name: Client_document_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Client_document_unique_idx" ON public."Client" USING btree (document) WHERE (document IS NOT NULL);


--
-- Name: Client_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Client_email_idx" ON public."Client" USING btree (email);


--
-- Name: Client_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Client_name_idx" ON public."Client" USING btree (name);


--
-- Name: Contact_clientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Contact_clientId_idx" ON public."Contact" USING btree ("clientId");


--
-- Name: Contract_eventId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Contract_eventId_idx" ON public."Contract" USING btree ("eventId");


--
-- Name: Event_clientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Event_clientId_idx" ON public."Event" USING btree ("clientId");


--
-- Name: Event_eventDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Event_eventDate_idx" ON public."Event" USING btree ("eventDate");


--
-- Name: Event_eventTypeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Event_eventTypeId_idx" ON public."Event" USING btree ("eventTypeId");


--
-- Name: Event_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Event_status_idx" ON public."Event" USING btree (status);


--
-- Name: Event_venueId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Event_venueId_idx" ON public."Event" USING btree ("venueId");


--
-- Name: Interaction_opportunityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Interaction_opportunityId_idx" ON public."Interaction" USING btree ("opportunityId");


--
-- Name: Lead_clientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Lead_clientId_idx" ON public."Lead" USING btree ("clientId");


--
-- Name: Lead_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Lead_status_idx" ON public."Lead" USING btree (status);


--
-- Name: Opportunity_clientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Opportunity_clientId_idx" ON public."Opportunity" USING btree ("clientId");


--
-- Name: Opportunity_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Opportunity_stage_idx" ON public."Opportunity" USING btree (stage);


--
-- Name: ProductService_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductService_active_idx" ON public."ProductService" USING btree (active);


--
-- Name: ProductService_categoryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductService_categoryId_idx" ON public."ProductService" USING btree ("categoryId");


--
-- Name: ScheduleItem_eventId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ScheduleItem_eventId_idx" ON public."ScheduleItem" USING btree ("eventId");


--
-- Name: ScheduleItem_startsAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ScheduleItem_startsAt_idx" ON public."ScheduleItem" USING btree ("startsAt");


--
-- Name: SupplierProduct_productServiceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupplierProduct_productServiceId_idx" ON public."SupplierProduct" USING btree ("productServiceId");


--
-- Name: SupplierProduct_supplierId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupplierProduct_supplierId_idx" ON public."SupplierProduct" USING btree ("supplierId");


--
-- Name: Task_eventId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Task_eventId_idx" ON public."Task" USING btree ("eventId");


--
-- Name: Task_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Task_status_idx" ON public."Task" USING btree (status);


--
-- Name: Transaction_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Transaction_date_idx" ON public."Transaction" USING btree (date);


--
-- Name: Transaction_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Transaction_kind_idx" ON public."Transaction" USING btree (kind);


--
-- Name: Transaction_payableId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Transaction_payableId_idx" ON public."Transaction" USING btree ("payableId");


--
-- Name: Transaction_receivableId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Transaction_receivableId_idx" ON public."Transaction" USING btree ("receivableId");


--
-- Name: User_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_active_idx" ON public."User" USING btree (active);


--
-- Name: AccountPayable AccountPayable_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccountPayable"
    ADD CONSTRAINT "AccountPayable_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: AccountPayable AccountPayable_supplierId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccountPayable"
    ADD CONSTRAINT "AccountPayable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES public."Supplier"(id);


--
-- Name: AccountReceivable AccountReceivable_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccountReceivable"
    ADD CONSTRAINT "AccountReceivable_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: AuditLog AuditLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE SET NULL;


--
-- Name: BudgetItem BudgetItem_budgetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BudgetItem"
    ADD CONSTRAINT "BudgetItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES public."Budget"(id);


--
-- Name: BudgetItem BudgetItem_productServiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BudgetItem"
    ADD CONSTRAINT "BudgetItem_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES public."ProductService"(id);


--
-- Name: Budget Budget_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Budget"
    ADD CONSTRAINT "Budget_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id);


--
-- Name: Budget Budget_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Budget"
    ADD CONSTRAINT "Budget_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: Budget Budget_opportunityId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Budget"
    ADD CONSTRAINT "Budget_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES public."Opportunity"(id);


--
-- Name: ChecklistItem ChecklistItem_checklistId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChecklistItem"
    ADD CONSTRAINT "ChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES public."Checklist"(id);


--
-- Name: Checklist Checklist_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checklist"
    ADD CONSTRAINT "Checklist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: Contact Contact_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contact"
    ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id);


--
-- Name: Contract Contract_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id);


--
-- Name: Contract Contract_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: Event Event_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id);


--
-- Name: Event Event_commercialId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES public."User"(id);


--
-- Name: Event Event_eventTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES public."EventType"(id);


--
-- Name: Event Event_operationalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_operationalId_fkey" FOREIGN KEY ("operationalId") REFERENCES public."User"(id);


--
-- Name: Event Event_opportunityId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES public."Opportunity"(id);


--
-- Name: Event Event_venueId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES public."Venue"(id);


--
-- Name: Interaction Interaction_opportunityId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Interaction"
    ADD CONSTRAINT "Interaction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES public."Opportunity"(id);


--
-- Name: Interaction Interaction_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Interaction"
    ADD CONSTRAINT "Interaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: Lead Lead_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Lead"
    ADD CONSTRAINT "Lead_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id);


--
-- Name: Opportunity Opportunity_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Opportunity"
    ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id);


--
-- Name: Opportunity Opportunity_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Opportunity"
    ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id);


--
-- Name: ProductService ProductService_categoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductService"
    ADD CONSTRAINT "ProductService_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public."Category"(id);


--
-- Name: ScheduleItem ScheduleItem_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ScheduleItem"
    ADD CONSTRAINT "ScheduleItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: SupplierProduct SupplierProduct_productServiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupplierProduct"
    ADD CONSTRAINT "SupplierProduct_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES public."ProductService"(id);


--
-- Name: SupplierProduct SupplierProduct_supplierId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupplierProduct"
    ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES public."Supplier"(id);


--
-- Name: Task Task_assigneeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Task"
    ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES public."User"(id);


--
-- Name: Task Task_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Task"
    ADD CONSTRAINT "Task_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: Transaction Transaction_eventId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES public."Event"(id);


--
-- Name: AccountPayable; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AccountPayable" ENABLE ROW LEVEL SECURITY;

--
-- Name: AccountReceivable; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."AccountReceivable" ENABLE ROW LEVEL SECURITY;

--
-- Name: Budget; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Budget" ENABLE ROW LEVEL SECURITY;

--
-- Name: BudgetItem; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BudgetItem" ENABLE ROW LEVEL SECURITY;

--
-- Name: Category; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Category" ENABLE ROW LEVEL SECURITY;

--
-- Name: Checklist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Checklist" ENABLE ROW LEVEL SECURITY;

--
-- Name: ChecklistItem; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ChecklistItem" ENABLE ROW LEVEL SECURITY;

--
-- Name: Client; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Client" ENABLE ROW LEVEL SECURITY;

--
-- Name: Contact; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Contact" ENABLE ROW LEVEL SECURITY;

--
-- Name: Contract; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Contract" ENABLE ROW LEVEL SECURITY;

--
-- Name: Event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Event" ENABLE ROW LEVEL SECURITY;

--
-- Name: EventType; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EventType" ENABLE ROW LEVEL SECURITY;

--
-- Name: Interaction; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Interaction" ENABLE ROW LEVEL SECURITY;

--
-- Name: Lead; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Lead" ENABLE ROW LEVEL SECURITY;

--
-- Name: Opportunity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Opportunity" ENABLE ROW LEVEL SECURITY;

--
-- Name: ProductService; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ProductService" ENABLE ROW LEVEL SECURITY;

--
-- Name: ScheduleItem; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ScheduleItem" ENABLE ROW LEVEL SECURITY;

--
-- Name: Supplier; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Supplier" ENABLE ROW LEVEL SECURITY;

--
-- Name: SupplierProduct; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SupplierProduct" ENABLE ROW LEVEL SECURITY;

--
-- Name: Task; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Task" ENABLE ROW LEVEL SECURITY;

--
-- Name: Transaction; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Transaction" ENABLE ROW LEVEL SECURITY;

--
-- Name: User; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;

--
-- Name: Venue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."Venue" ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict bCL4hi4icVyWreJzHhPvrLSV6AfvDU31PUOPa8YCmdtfXQV4FUWoWe5Ta3ZNzx1

