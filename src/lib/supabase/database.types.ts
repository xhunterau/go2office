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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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

export type Enums<
  T extends keyof PublicSchema["Enums"],
> = PublicSchema["Enums"][T]
