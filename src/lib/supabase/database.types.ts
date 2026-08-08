export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// NOTE: This file mirrors the tables defined in supabase/migrations/*.sql.
// The generated CLI (`supabase gen types`) requires Docker/podman or `supabase login`,
// neither of which is available in this environment, so it is maintained by hand.
// Regenerate with the CLI once a container runtime or login is available.
export type Database = {
  public: {
    Tables: {
      origins: {
        Row: {
          id: number
          name: string | null
          abbr: string | null
        }
        Insert: {
          id?: number
          name?: string | null
          abbr?: string | null
        }
        Update: {
          id?: number
          name?: string | null
          abbr?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          id: number
          name: string | null
          abbr: string | null
        }
        Insert: {
          id?: number
          name?: string | null
          abbr?: string | null
        }
        Update: {
          id?: number
          name?: string | null
          abbr?: string | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          id: number
          company_name: string | null
          contact_person: string | null
          email: string | null
          phone: string | null
          comments: string | null
        }
        Insert: {
          id?: number
          company_name?: string | null
          contact_person?: string | null
          email?: string | null
          phone?: string | null
          comments?: string | null
        }
        Update: {
          id?: number
          company_name?: string | null
          contact_person?: string | null
          email?: string | null
          phone?: string | null
          comments?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          id: number
          sku: string
          model: string | null
          upc: string | null
          brand_id: number | null
          name: string | null
          image_url: string | null
          origin_id: number
          supplier_id: number | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          purchase_price: number | null
          is_gst: boolean
          weight: number
          length: number
          width: number
          height: number
          retail_price: number | null
          is_active: boolean
          comment: string | null
          is_kit: boolean
          ebay_title: string | null
          description: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          sku: string
          model?: string | null
          upc?: string | null
          brand_id?: number | null
          name?: string | null
          image_url?: string | null
          origin_id: number
          supplier_id?: number | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          purchase_price?: number | null
          is_gst: boolean
          weight: number
          length: number
          width: number
          height: number
          retail_price?: number | null
          is_active: boolean
          comment?: string | null
          is_kit: boolean
          ebay_title?: string | null
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          sku?: string
          model?: string | null
          upc?: string | null
          brand_id?: number | null
          name?: string | null
          image_url?: string | null
          origin_id?: number
          supplier_id?: number | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          purchase_price?: number | null
          is_gst?: boolean
          weight?: number
          length?: number
          width?: number
          height?: number
          retail_price?: number | null
          is_active?: boolean
          comment?: string | null
          is_kit?: boolean
          ebay_title?: string | null
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_origin_id_fkey"
            columns: ["origin_id"]
            isOneToOne: false
            referencedRelation: "origins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_kit_items: {
        Row: {
          id: number
          kit_product_id: number
          component_product_id: number
          qty: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          kit_product_id: number
          component_product_id: number
          qty: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          kit_product_id?: number
          component_product_id?: number
          qty?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_kit_items_kit_product_id_fkey"
            columns: ["kit_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_kit_items_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          id: number
          usd_to_aud: number
          aud_to_cny: number
          gst_rate: number
          air_freight_aud_per_kg: number
          sea_freight_aud_per_cbm: number
          air_volumetric_kg_per_cbm: number
          sea_volumetric_kg_per_cbm: number
          updated_at: string
        }
        Insert: {
          id?: number
          usd_to_aud: number
          aud_to_cny: number
          gst_rate?: number
          air_freight_aud_per_kg: number
          sea_freight_aud_per_cbm: number
          air_volumetric_kg_per_cbm?: number
          sea_volumetric_kg_per_cbm?: number
          updated_at?: string
        }
        Update: {
          id?: number
          usd_to_aud?: number
          aud_to_cny?: number
          gst_rate?: number
          air_freight_aud_per_kg?: number
          sea_freight_aud_per_cbm?: number
          air_volumetric_kg_per_cbm?: number
          sea_volumetric_kg_per_cbm?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_markup_tiers: {
        Row: {
          id: number
          min_cost: number
          max_cost: number | null
          multiplier: number
        }
        Insert: {
          id?: number
          min_cost: number
          max_cost?: number | null
          multiplier: number
        }
        Update: {
          id?: number
          min_cost?: number
          max_cost?: number | null
          multiplier?: number
        }
        Relationships: []
      }
      locations: {
        Row: {
          id: number
          name: string
          comments: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          name: string
          comments?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          name?: string
          comments?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_levels: {
        Row: {
          id: number
          product_id: number
          location_id: number
          qty: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          product_id: number
          location_id: number
          qty?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          product_id?: number
          location_id?: number
          qty?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      // Append-only ledger. There is no Update type on purpose: authenticated
      // holds SELECT and INSERT only (migration 20260801140000), and rows are
      // written through the record_stock_movement / set_stock_level /
      // move_stock functions rather than inserted directly.
      inventory_movements: {
        Row: {
          id: number
          product_id: number
          location_id: number
          kind: Database["public"]["Enums"]["stock_movement_kind"]
          qty_delta: number
          qty_after: number
          note: string | null
          counterpart_location_id: number | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          product_id: number
          location_id: number
          kind: Database["public"]["Enums"]["stock_movement_kind"]
          qty_delta: number
          qty_after: number
          note?: string | null
          counterpart_location_id?: number | null
          created_by?: string | null
          created_at?: string
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_counterpart_location_id_fkey"
            columns: ["counterpart_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      // Audit trail for ledger prunes (migration 20260802100000). Read-only to
      // the application: rows are written by prune_product_movements, which runs
      // as its owner, so there is neither an Insert nor an Update type.
      inventory_movement_prunes: {
        Row: {
          id: number
          product_id: number
          kept: number
          deleted_count: number
          qty_in: number
          qty_out: number
          first_at: string
          last_at: string
          pruned_by: string | null
          pruned_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "inventory_movement_prunes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      // Orders domain (migrations 20260803100000-20260803160000).
      // See docs/orders-domain-migration.md.
      customers: {
        Row: {
          id: number
          platform_user_id: string | null
          full_name: string | null
          email: string | null
          phone: string | null
          is_anonymised_email: boolean
          // The customer's CURRENT address, taken from their most recent order.
          // Orders do not keep their own copy, so an order placed before the
          // customer moved renders against this address (8150 orders are in
          // that position). Migrated verbatim: NSW and New South Wales both
          // occur, and address_line3 holds an `ebay:xxxx` reference code on
          // ~129k rows rather than an address line.
          company_name: string | null
          address_line1: string | null
          address_line2: string | null
          address_line3: string | null
          address_line4: string | null
          city: string | null
          state: string | null
          postcode: string | null
          country: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          platform_user_id?: string | null
          full_name?: string | null
          email?: string | null
          phone?: string | null
          is_anonymised_email?: boolean
          company_name?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_line4?: string | null
          city?: string | null
          state?: string | null
          postcode?: string | null
          country?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          platform_user_id?: string | null
          full_name?: string | null
          email?: string | null
          phone?: string | null
          is_anonymised_email?: boolean
          company_name?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_line3?: string | null
          address_line4?: string | null
          city?: string | null
          state?: string | null
          postcode?: string | null
          country?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          id: number
          customer_id: number
          invoice_number: string
          status: Database["public"]["Enums"]["order_status"]
          platform: Database["public"]["Enums"]["sales_platform"]
          shipping_method: Database["public"]["Enums"]["shipping_method"] | null
          // Historical value for the seven retired carriers that have no home in
          // the shipping_method enum. Read as
          // shipping_method ?? legacy_shipping_method.
          legacy_shipping_method: string | null
          // Postage for the whole order. Upstream it was per transaction line;
          // migration 20260803170000 summed it up to here.
          postage_and_handling: number
          tracking_number: string | null
          web_order_id: string | null
          comments: string | null
          posted_on_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          customer_id: number
          invoice_number: string
          status: Database["public"]["Enums"]["order_status"]
          platform: Database["public"]["Enums"]["sales_platform"]
          shipping_method?: Database["public"]["Enums"]["shipping_method"] | null
          legacy_shipping_method?: string | null
          postage_and_handling?: number
          tracking_number?: string | null
          web_order_id?: string | null
          comments?: string | null
          posted_on_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          customer_id?: number
          invoice_number?: string
          status?: Database["public"]["Enums"]["order_status"]
          platform?: Database["public"]["Enums"]["sales_platform"]
          shipping_method?: Database["public"]["Enums"]["shipping_method"] | null
          legacy_shipping_method?: string | null
          postage_and_handling?: number
          tracking_number?: string | null
          web_order_id?: string | null
          comments?: string | null
          posted_on_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_transactions: {
        Row: {
          id: number
          order_id: number
          item_title: string | null
          item_number: string | null
          custom_label: string | null
          quantity: number
          sale_price: number
          sale_date: string
          paid_on_date: string
          postage_service: string | null
          sales_record_number: string | null
          order_id_ebay: string | null
          transaction_id_ebay: string | null
          click_and_collect_reference: string | null
          private_field: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          order_id: number
          item_title?: string | null
          item_number?: string | null
          custom_label?: string | null
          quantity: number
          sale_price?: number
          sale_date: string
          paid_on_date: string
          postage_service?: string | null
          sales_record_number?: string | null
          order_id_ebay?: string | null
          transaction_id_ebay?: string | null
          click_and_collect_reference?: string | null
          private_field?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          order_id?: number
          item_title?: string | null
          item_number?: string | null
          custom_label?: string | null
          quantity?: number
          sale_price?: number
          sale_date?: string
          paid_on_date?: string
          postage_service?: string | null
          sales_record_number?: string | null
          order_id_ebay?: string | null
          transaction_id_ebay?: string | null
          click_and_collect_reference?: string | null
          private_field?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: number
          transaction_id: number
          // Null when custom_label resolved to no product, or when the product
          // was deleted. sku_snapshot is then the only identifying information.
          product_id: number | null
          sku_snapshot: string | null
          quantity: number
          location_id: number | null
          is_auto_generated: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          transaction_id: number
          product_id?: number | null
          sku_snapshot?: string | null
          quantity: number
          location_id?: number | null
          is_auto_generated?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          transaction_id?: number
          product_id?: number | null
          sku_snapshot?: string | null
          quantity?: number
          location_id?: number | null
          is_auto_generated?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "order_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      product_pricing: {
        Row: {
          id: number
          sku: string
          name: string | null
          brand_id: number | null
          supplier_id: number | null
          image_url: string | null
          is_active: boolean
          // Kits report AUD: their cost is a roll-up already stated in AUD.
          currency: Database["public"]["Enums"]["currency_code"] | null
          // For a kit this is the roll-up, not an entered price.
          purchase_price: number | null
          retail_price: number | null
          // Always 'LP' / 'Local Purchase' for kits.
          origin_abbr: string | null
          origin_name: string | null
          // The physical columns below are null for a kit with no components,
          // and height/volume are also null when every component has a zero
          // dimension (a footprint of zero has no equivalent height).
          weight: number | null
          volume_cbm: number | null
          chargeable_cbm: number | null
          chargeable_kg: number | null
          // 'volume' | 'weight' | 'none' — which side won the chargeable
          // comparison, or 'none' for local purchases (all kits) with no freight.
          chargeable_basis: string
          // Every money column below is null when the product has no
          // currency/purchase_price, and for a kit that has no components or
          // whose components cannot all be costed: the view propagates NULL
          // rather than inventing a cost.
          purchase_price_aud: number | null
          freight_cost_aud: number | null
          unit_cost_aud: number | null
          markup_multiplier: number | null
          suggested_retail_price: number | null
          retail_profit: number | null
          retail_margin_pct: number | null
          suggested_retail_profit: number | null
          suggested_retail_margin_pct: number | null
          is_kit: boolean
          // Stored dimensions for a product, derived ones for a kit (mm).
          length_mm: number | null
          width_mm: number | null
          height_mm: number | null
          // Null for a product, the number of component lines for a kit (0 when
          // it has been flagged as a kit but never given any).
          component_count: number | null
        }
        Relationships: []
      }
      // Internal inputs to product_pricing, listed here only because every view
      // gets an entry (CLAUDE.md rule 18). Application code should read
      // product_pricing: these two are unrounded and carry no markup or margin.
      product_cost_base: {
        Row: {
          id: number
          sku: string
          name: string | null
          brand_id: number | null
          supplier_id: number | null
          image_url: string | null
          is_active: boolean
          is_kit: boolean
          currency: Database["public"]["Enums"]["currency_code"] | null
          purchase_price: number | null
          retail_price: number | null
          origin_abbr: string | null
          origin_name: string | null
          weight: number
          length_mm: number
          width_mm: number
          height_mm: number
          volume_cbm: number
          chargeable_cbm: number
          chargeable_kg: number
          chargeable_basis: string
          purchase_price_aud: number | null
          freight_cost_aud: number | null
          unit_cost_aud: number | null
          component_count: number | null
          gst_rate: number
        }
        Relationships: []
      }
      product_cost_kit: {
        Row: {
          id: number
          sku: string
          name: string | null
          brand_id: number | null
          supplier_id: number | null
          image_url: string | null
          is_active: boolean
          is_kit: boolean
          currency: Database["public"]["Enums"]["currency_code"]
          purchase_price: number | null
          retail_price: number | null
          origin_abbr: string
          origin_name: string
          weight: number | null
          length_mm: number | null
          width_mm: number | null
          height_mm: number | null
          volume_cbm: number | null
          chargeable_cbm: number | null
          chargeable_kg: number | null
          chargeable_basis: string
          purchase_price_aud: number | null
          freight_cost_aud: number
          unit_cost_aud: number | null
          component_count: number
          gst_rate: number
        }
        Relationships: []
      }
      product_list_pricing: {
        Row: {
          id: number
          sku: string
          name: string | null
          model: string | null
          upc: string | null
          brand_id: number | null
          supplier_id: number | null
          image_url: string | null
          retail_price: number | null
          is_active: boolean
          is_kit: boolean
          created_at: string | null
          brand_name: string | null
          // Null for products with no currency / purchase price, and for kits
          // with no components or with a component that has no cost of its own.
          unit_cost_aud: number | null
          retail_margin_pct: number | null
          // Never null: product_stock LEFT JOINs from products, so every
          // product gets a row (0 when it has no stock anywhere).
          on_hand: number
        }
        Relationships: []
      }
      product_stock: {
        Row: {
          product_id: number
          on_hand: number
          location_count: number
          // Null when no location holds a positive quantity.
          location_names: string | null
        }
        Relationships: []
      }
      // Replaces the dropped go2_orders.total_sale column (migration
      // 20260803160000). Do not join this in a paginated list query -- it
      // aggregates all order_transactions rows every time it is referenced.
      // Page first, then select the totals for that page's ids.
      order_totals: {
        Row: {
          order_id: number
          goods_total: number
          // goods_total + orders.postage_and_handling. There is no postage_total
          // any more: postage is a plain column on orders, so aggregating it
          // here would just read one row back.
          order_total: number
          transaction_count: number
        }
        Relationships: []
      }
      // One row per order_status actually present in orders (migration
      // 20260808100000). Backs the status tabs on /orders.
      //
      // Unlike order_totals this one IS meant to be queried directly: it is a
      // single index-only scan on orders_status_idx, issued once per page load
      // rather than joined per row. It exists at all because PostgREST
      // top-level aggregates are disabled here -- `select=status,count()`
      // returns PGRST123. See docs/orders-ui.md section 4.3 decision A.
      //
      // Statuses with no orders do not appear. Render the tab row from the
      // order_status enum and default a missing status to 0; do not derive the
      // tab list from these rows.
      order_status_counts: {
        Row: {
          status: Database["public"]["Enums"]["order_status"]
          order_count: number
        }
        Relationships: []
      }
    }
    Functions: {
      charm_price: {
        Args: { value: number }
        Returns: number
      }
      // Applies a signed delta and writes the matching ledger row. Returns the
      // new inventory_movements.id.
      record_stock_movement: {
        Args: {
          p_product_id: number
          p_location_id: number
          p_kind: Database["public"]["Enums"]["stock_movement_kind"]
          p_qty_delta: number
          p_note?: string | null
          p_counterpart_location_id?: number | null
        }
        Returns: number
      }
      // Stocktake: sets an absolute quantity and records the difference.
      // Returns null when the count matches what is already on file.
      set_stock_level: {
        Args: {
          p_product_id: number
          p_location_id: number
          p_new_qty: number
          p_note?: string | null
        }
        Returns: number | null
      }
      move_stock: {
        Args: {
          p_product_id: number
          p_from_location_id: number
          p_to_location_id: number
          p_qty: number
          p_note?: string | null
        }
        Returns: undefined
      }
      // Deletes one product's movements except the p_keep most recent, and
      // returns a single-row summary of what went. RETURNS TABLE, so the result
      // arrives as an array; the timestamps are null when nothing matched.
      prune_product_movements: {
        Args: {
          p_product_id: number
          p_keep?: number
        }
        Returns: {
          deleted_count: number
          qty_in: number
          qty_out: number
          first_at: string | null
          last_at: string | null
        }[]
      }
      // Rebuilds one transaction's order_items from its custom_label and
      // quantity, expanding kits through product_kit_items. Returns the number of
      // rows written. The triggers call this; call it directly only to repair a
      // row by hand.
      rebuild_order_items: {
        Args: { p_transaction_id: number }
        Returns: number
      }
      // Same, for every transaction on an order. This is the only supported way
      // to pull a historical order up to the current BOM -- editing
      // product_kit_items does not do it.
      rebuild_order_items_for_order: {
        Args: { p_order_id: number }
        Returns: number
      }
    }
    Enums: {
      currency_code: "USD" | "AUD" | "CNY"
      stock_movement_kind:
        | "receive"
        | "dispatch"
        | "adjust"
        | "move_in"
        | "move_out"
      // Declared in business-lifecycle order (migration 20260804100000), which
      // is also the enum's sort order -- keep this list in that order so a
      // dropdown built by iterating it comes out right.
      // 'labelled' is the British double-L spelling, matching Laravel's value;
      // 004 casts with lower() and no mapping, so it has to match exactly.
      // `new` was dropped by 20260808120000: it was imported from the Laravel
      // dropdown and never used by this business.
      order_status:
        | "pending"
        | "unpaid"
        | "backorder"
        | "processing"
        | "picked"
        | "labelled"
        | "issued"
        | "completed"
        | "cancelled"
      sales_platform: "ebay" | "shopify" | "backorder" | "store"
      // PascalCase_Snake by design: these are the labels the business supplied.
      // The inconsistency with the lowercase enums above is known and accepted
      // (docs/orders-domain-migration.md section 4.1).
      shipping_method:
        | "Letter"
        | "Register_Letter"
        | "Parcel_Post"
        | "Express_Post"
        | "Eparcel_Regular"
        | "Eparcel_Express"
        | "Eparcel_Intl_Express"
        | "Mypost_Regular"
        | "Mypost_Express"
        | "Mypost_Reg_Xs_Box"
        | "Mypost_Reg_S_Box"
        | "Mypost_Reg_M_Box"
        | "Mypost_Reg_L_Box"
        | "Mypost_Reg_XL_Box"
        | "Mypost_Exp_Xs_Box"
        | "Mypost_Exp_S_Box"
        | "Mypost_Exp_M_Box"
        | "Mypost_Exp_L_Box"
        | "Mypost_Exp_XL_Box"
        | "Mypost_Reg_Xs_Satchel"
        | "Mypost_Reg_S_Satchel"
        | "Mypost_Reg_M_Satchel"
        | "Mypost_Reg_L_Satchel"
        | "Mypost_Reg_XL_Satchel"
        | "Mypost_Exp_Xs_Satchel"
        | "Mypost_Exp_S_Satchel"
        | "Mypost_Exp_M_Satchel"
        | "Mypost_Exp_L_Satchel"
        | "Mypost_Exp_XL_Satchel"
        | "Store_Delivery"
        | "Direct_Freight"
        | "Click_and_Collect"
        | "Aramex_Parcel"
        | "Aramex_Satchel"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<
  T extends keyof PublicSchema["Tables"],
> = PublicSchema["Tables"][T]["Row"]

export type TablesInsert<
  T extends keyof PublicSchema["Tables"],
> = PublicSchema["Tables"][T]["Insert"]

export type TablesUpdate<
  T extends keyof PublicSchema["Tables"],
> = PublicSchema["Tables"][T]["Update"]

export type Views<
  T extends keyof PublicSchema["Views"],
> = PublicSchema["Views"][T]["Row"]

export type Enums<
  T extends keyof PublicSchema["Enums"],
> = PublicSchema["Enums"][T]
