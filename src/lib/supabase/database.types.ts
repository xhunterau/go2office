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
          // Outbound domestic parcels only. Separate from the two inbound
          // freight factors above on purpose -- see migration 20260808160000.
          parcel_volumetric_kg_per_cbm: number
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
          parcel_volumetric_kg_per_cbm?: number
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
          parcel_volumetric_kg_per_cbm?: number
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
      postcodes: {
        Row: {
          id: number
          // Always four digits, zero-padded (NT is 08xx, ACT 02xx). Text, not a
          // number, precisely so those leading zeros survive.
          postcode: string
          // Uppercase. Matched against upper(customers.city) by
          // standardize_customer_address().
          locality: string
          // Null on 136 alias localities that Australia Post lists without one.
          state: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          postcode: string
          locality: string
          state?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          postcode?: string
          locality?: string
          state?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      countries: {
        Row: {
          id: number
          country_name: string
          // ISO 3166-1 alpha-2, enforced by a CHECK constraint.
          country_code: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          country_name: string
          country_code: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          country_name?: string
          country_code?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      carriers: {
        Row: {
          id: number
          // Lowercase, unique, and CHECK-enforced: this is the key
          // CARRIER_CAPABILITIES looks a carrier's weight and size limits up by.
          // Rename in `name`, never here.
          code: string
          name: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          code: string
          name: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          code?: string
          name?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      carrier_services: {
        Row: {
          id: number
          carrier_id: number
          // Lowercase on both this and carrier_dispatch_options.service_type, so
          // the join between them needs no case folding.
          service_type: string
          size_label: string
          // Null marks the per-kg overflow tier, which applies above every fixed
          // tier. MyPost has none -- it stops at 5kg.
          max_weight: number | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          carrier_id: number
          service_type: string
          size_label: string
          max_weight?: number | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          carrier_id?: number
          service_type?: string
          size_label?: string
          max_weight?: number | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_services_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_zone_rates: {
        Row: {
          id: number
          service_id: number
          zone: string
          // Fixed tiers price off `rate`; the per_kg tier off base_rate +
          // per_kg_rate, floored at min_charge. A CHECK constraint requires one
          // of the two -- a row with neither would quote $0 and win.
          rate: number | null
          base_rate: number | null
          per_kg_rate: number | null
          // Null on all 138 seeded rows; the column exists because the rate
          // lookup honours it, not because this contract sets one.
          min_charge: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          service_id: number
          zone: string
          rate?: number | null
          base_rate?: number | null
          per_kg_rate?: number | null
          min_charge?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          service_id?: number
          zone?: string
          rate?: number | null
          base_rate?: number | null
          per_kg_rate?: number | null
          min_charge?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_zone_rates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "carrier_services"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_dispatch_options: {
        Row: {
          id: number
          shipping_method: Database["public"]["Enums"]["shipping_method"]
          carrier_id: number
          billing_weight_mode: string
          // Joins to carrier_services.service_type. Null for carriers that do
          // not read the rate card at all (aramex, reg_letter).
          service_type: string | null
          // Non-null short-circuits everything: no zone lookup, no rate card.
          // Only Register_Letter has one.
          fixed_price_aud: number | null
          max_order_total_aud: number | null
          max_packed_thickness_mm: number | null
          max_packed_length_mm: number | null
          max_packed_width_mm: number | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          shipping_method: Database["public"]["Enums"]["shipping_method"]
          carrier_id: number
          billing_weight_mode?: string
          service_type?: string | null
          fixed_price_aud?: number | null
          max_order_total_aud?: number | null
          max_packed_thickness_mm?: number | null
          max_packed_length_mm?: number | null
          max_packed_width_mm?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          shipping_method?: Database["public"]["Enums"]["shipping_method"]
          carrier_id?: number
          billing_weight_mode?: string
          service_type?: string | null
          fixed_price_aud?: number | null
          max_order_total_aud?: number | null
          max_packed_thickness_mm?: number | null
          max_packed_length_mm?: number | null
          max_packed_width_mm?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_dispatch_options_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      flat_rate_package_specs: {
        Row: {
          id: number
          // 'satchel' | 'box', CHECK-enforced.
          package_type: string
          // 'XS' | 'S' | 'M' | 'L' | 'XL', CHECK-enforced. There is no box XS --
          // Australia Post does not sell one.
          size_label: string
          length_mm: number
          width_mm: number
          // Null on satchels, which have no fixed depth.
          depth_mm: number | null
          // What the carrier charges the packaging as, whatever is inside it.
          maps_to_weight_kg: number
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          package_type: string
          size_label: string
          length_mm: number
          width_mm: number
          depth_mm?: number | null
          maps_to_weight_kg: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          package_type?: string
          size_label?: string
          length_mm?: number
          width_mm?: number
          depth_mm?: number | null
          maps_to_weight_kg?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipping_settings: {
        Row: {
          id: number
          au_post_max_length_mm: number
          au_post_max_weight_kg: number
          eparcel_oversize_surcharge_aud: number
          eparcel_oversize_threshold_mm: number
          eparcel_fuel_charge_rate: number
          // How much cheaper a quote must be to beat the carrier-priority order
          // outright. xpros hard-codes this as 0.05.
          quote_tiebreak_threshold: number
          updated_at: string
        }
        Insert: {
          id?: number
          au_post_max_length_mm?: number
          au_post_max_weight_kg?: number
          eparcel_oversize_surcharge_aud?: number
          eparcel_oversize_threshold_mm?: number
          eparcel_fuel_charge_rate?: number
          quote_tiebreak_threshold?: number
          updated_at?: string
        }
        Update: {
          id?: number
          au_post_max_length_mm?: number
          au_post_max_weight_kg?: number
          eparcel_oversize_surcharge_aud?: number
          eparcel_oversize_threshold_mm?: number
          eparcel_fuel_charge_rate?: number
          quote_tiebreak_threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      postcode_carrier_zones: {
        Row: {
          id: number
          postcode_id: number
          carrier_id: number
          zone: string
          // Null in every xpros row, so NOT NULL DEFAULT 0 here.
          surcharge: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          postcode_id: number
          carrier_id: number
          zone: string
          surcharge?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          postcode_id?: number
          carrier_id?: number
          zone?: string
          surcharge?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postcode_carrier_zones_postcode_id_fkey"
            columns: ["postcode_id"]
            isOneToOne: false
            referencedRelation: "postcodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postcode_carrier_zones_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_shipping_quotes: {
        Row: {
          id: number
          order_id: number
          carrier_id: number
          shipping_method: Database["public"]["Enums"]["shipping_method"]
          // Null for options that never touched the rate card (fixed price, API).
          service_id: number | null
          zone: string | null
          quoted_rate: number
          // 'rate_card' | 'api', CHECK-enforced.
          computation_type: string
          is_selected: boolean
          // Set when the option could not be priced; quoted_rate stays 0 and the
          // row is excluded from selection.
          error_message: string | null
          // Rows written by one Re-Quote run share this value -- that is how the
          // panel isolates the latest batch.
          quoted_at: string
          created_at: string
        }
        Insert: {
          id?: number
          order_id: number
          carrier_id: number
          shipping_method: Database["public"]["Enums"]["shipping_method"]
          service_id?: number | null
          zone?: string | null
          quoted_rate?: number
          computation_type: string
          is_selected?: boolean
          error_message?: string | null
          quoted_at?: string
          created_at?: string
        }
        Update: {
          id?: number
          order_id?: number
          carrier_id?: number
          shipping_method?: Database["public"]["Enums"]["shipping_method"]
          service_id?: number | null
          zone?: string | null
          quoted_rate?: number
          computation_type?: string
          is_selected?: boolean
          error_message?: string | null
          quoted_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_shipping_quotes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_shipping_quotes_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_shipping_quotes_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "carrier_services"
            referencedColumns: ["id"]
          },
        ]
      }
      order_logs: {
        Row: {
          id: number
          order_id: number
          action: string
          // Null when the actor is a background task rather than a person --
          // which is every row the quote engine writes.
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: number
          order_id: number
          action: string
          user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          order_id?: number
          action?: string
          user_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
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
          // that position). address_line3 holds an `ebay:xxxx` reference code on
          // ~129k rows rather than an address line.
          //
          // `state` and `country` are NOT verbatim: the
          // customers_standardize_address trigger (migration 20260809130000)
          // rewrites country to its ISO code and derives state from
          // postcode + city on every insert and update. The other address
          // fields are still exactly what the legacy data carried.
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
          // migration 20260803170000 summed it up to here. This is what the
          // CUSTOMER paid.
          postage_and_handling: number
          // What we paid the carrier, and what we discounted. Both added by
          // migration 20260808160000 and 0 on all 203315 migrated orders --
          // legacy data recorded neither, so gross_profit on a historical order
          // is overstated by roughly the postage.
          postage_paid: number
          discount: number
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
          postage_paid?: number
          discount?: number
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
          postage_paid?: number
          discount?: number
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
      // Per-order aggregates, maintained by trigger (migration 20260808170000).
      // Replaces the order_totals view, which was dropped.
      //
      // A real table, so it CAN be joined and sorted in a paginated list query
      // -- that is the whole reason it is materialised. Contrast the warning the
      // old view carried.
      //
      // Read-only from the application: no write policy, and no write grant
      // after migration 20260808200000 stripped the ones Supabase's default
      // privileges had handed out. The Insert/Update shapes below exist because
      // the supabase-js client generic requires them, not because anything can
      // use them. To refresh one order call the rebuild_order_metrics RPC.
      order_metrics_summary: {
        Row: {
          order_id: number
          total_items: number
          transaction_count: number
          // Item lines that resolved to no product. They carry a quantity but
          // no weight, size or cost, so every physical metric on this row is
          // understated when this is non-zero.
          unresolved_item_count: number
          // Item lines whose product has no derivable cost, understating
          // total_cost and gross_profit. Currently 0 across the whole table.
          uncosted_item_count: number
          // At least one line's product has a zero dimension and fell back to
          // the 10mm default, so the packed_* figures are a guess. True on
          // 13695 orders (6.7%) -- show it in the UI rather than printing the
          // size as if it were measured.
          has_estimated_dimensions: boolean
          total_weight_kg: number
          // The greater of total_weight_kg and the packed box's volumetric
          // weight, at pricing_settings.parcel_volumetric_kg_per_cbm.
          chargeable_weight_kg: number
          goods_total: number
          // goods_total + orders.postage_and_handling - orders.discount
          order_total: number
          total_cost: number
          // order_total - orders.postage_paid - total_cost * (1 + gst_rate).
          // Overstated on migrated orders, which all have postage_paid 0.
          gross_profit: number
          // Whole-order packing estimate in mm: units stacked along height.
          // Null when the order has no resolvable item lines at all (3981
          // orders: 25 with no transactions, 3697 with transactions but no
          // items, 251 whose items are all unresolved).
          packed_length_mm: number | null
          packed_width_mm: number | null
          packed_height_mm: number | null
          max_dimension_mm: number | null
          // Single-unit size of the order's heaviest product by chargeable
          // weight -- what to quote a carrier when the small items plausibly
          // ride inside the big item's carton. Null on the same orders as
          // packed_*, and individually null where that dimension is unrecorded.
          dominant_length_mm: number | null
          dominant_width_mm: number | null
          dominant_height_mm: number | null
          computed_at: string
        }
        Insert: {
          order_id: number
          total_items?: number
          transaction_count?: number
          unresolved_item_count?: number
          uncosted_item_count?: number
          has_estimated_dimensions?: boolean
          total_weight_kg?: number
          chargeable_weight_kg?: number
          goods_total?: number
          order_total?: number
          total_cost?: number
          gross_profit?: number
          packed_length_mm?: number | null
          packed_width_mm?: number | null
          packed_height_mm?: number | null
          max_dimension_mm?: number | null
          dominant_length_mm?: number | null
          dominant_width_mm?: number | null
          dominant_height_mm?: number | null
          computed_at?: string
        }
        Update: {
          order_id?: number
          total_items?: number
          transaction_count?: number
          unresolved_item_count?: number
          uncosted_item_count?: number
          has_estimated_dimensions?: boolean
          total_weight_kg?: number
          chargeable_weight_kg?: number
          goods_total?: number
          order_total?: number
          total_cost?: number
          gross_profit?: number
          packed_length_mm?: number | null
          packed_width_mm?: number | null
          packed_height_mm?: number | null
          max_dimension_mm?: number | null
          dominant_length_mm?: number | null
          dominant_width_mm?: number | null
          dominant_height_mm?: number | null
          computed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_metrics_summary_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
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
      // One row per order_status actually present in orders (migration
      // 20260808100000). Backs the status tabs on /orders.
      //
      // Safe to query directly: it is a single index-only scan on
      // orders_status_idx, issued once per page load rather than joined per
      // row. It exists at all because PostgREST
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
      // Distinct zones a carrier has, taken from postcode_carrier_zones UNION
      // the zones its rate card already prices (migration 20260812100000). The
      // second half matters: a zone with a rate but no postcodes behind it is
      // still reachable by the engine, so the rate card page has to show it.
      carrier_zones: {
        Row: {
          carrier_id: number
          zone: string
        }
        Relationships: []
      }
    }
    Functions: {
      charm_price: {
        Args: { value: number }
        Returns: number
      }
      // Strips the GS1-128 envelope a barcode gun produces down to the carrier
      // article ID. Idempotent, and returns the input unchanged when it has no
      // envelope, so it is safe to call on an already-clean value. The
      // orders_normalize_tracking_* triggers apply it on write; calling it
      // directly is only needed for bulk paths that disable those triggers.
      normalize_tracking_number: {
        Args: { p_tracking: string | null }
        Returns: string | null
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
      // Recomputes one order's row in order_metrics_summary and returns the
      // number of rows written (1, or 0 if the order is gone). The triggers keep
      // that table current on their own; call this to repair a row by hand, or
      // after changing a product that a specific order depends on.
      rebuild_order_metrics: {
        Args: { p_order_id: number }
        Returns: number
      }
      // Two more functions exist in the schema and are deliberately absent here,
      // because both are revoked from PUBLIC and cannot be called through
      // PostgREST (migrations 20260808170000 and 20260808190000):
      //
      //   recompute_order_metrics(bigint[])      -- the workhorse; a NULL
      //     argument refreshes all 203315 rows, which is why it is not exposed.
      //   refresh_stale_order_metrics(interval)  -- pg_cron's hourly pass.
      //
      // Adding entries for them would let application code call something that
      // can only fail at runtime.
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
      // `new` was dropped by 20260808120000 and `picked` by 20260808130000:
      // both were imported from the Laravel dropdown and never used by this
      // business.
      order_status:
        | "pending"
        | "unpaid"
        | "backorder"
        | "processing"
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
