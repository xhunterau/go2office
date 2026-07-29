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
        }
        Relationships: []
      }
    }
    Functions: {
      charm_price: {
        Args: { value: number }
        Returns: number
      }
    }
    Enums: {
      currency_code: "USD" | "AUD" | "CNY"
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
