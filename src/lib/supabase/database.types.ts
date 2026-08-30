export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name: string
          position: number
          store_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          is_active?: boolean
          name: string
          position?: number
          store_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          is_active?: boolean
          name?: string
          position?: number
          store_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: number
          order_id: number
          provider_ref: string | null
          sent_at: string | null
          status: string
          template: string
          to_address: string
        }
        Insert: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: never
          order_id: number
          provider_ref?: string | null
          sent_at?: string | null
          status?: string
          template: string
          to_address: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: never
          order_id?: number
          provider_ref?: string | null
          sent_at?: string | null
          status?: string
          template?: string
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      option_groups: {
        Row: {
          created_at: string
          id: number
          max_select: number
          min_select: number
          name: string
          position: number
          product_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          max_select?: number
          min_select?: number
          name: string
          position?: number
          product_id: number
        }
        Update: {
          created_at?: string
          id?: never
          max_select?: number
          min_select?: number
          name?: string
          position?: number
          product_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "option_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      options: {
        Row: {
          group_id: number
          id: number
          is_available: boolean
          name: string
          position: number
          price_delta_cents: number
        }
        Insert: {
          group_id: number
          id?: never
          is_available?: boolean
          name: string
          position?: number
          price_delta_cents?: number
        }
        Update: {
          group_id?: number
          id?: never
          is_available?: boolean
          name?: string
          position?: number
          price_delta_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      order_event_deliveries: {
        Row: {
          attempts: number
          created_at: string
          dead_at: string | null
          delivered_at: string | null
          endpoint_id: number
          event_id: number
          id: number
          last_attempt_at: string | null
          last_error: string | null
          locked_until: string | null
          store_id: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          delivered_at?: string | null
          endpoint_id: number
          event_id: number
          id?: never
          last_attempt_at?: string | null
          last_error?: string | null
          locked_until?: string | null
          store_id: number
        }
        Update: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          delivered_at?: string | null
          endpoint_id?: number
          event_id?: number
          id?: never
          last_attempt_at?: string | null
          last_error?: string | null
          locked_until?: string | null
          store_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_event_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "pos_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_event_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "order_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_event_deliveries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          attempts: number
          created_at: string
          dead_at: string | null
          delivered_at: string | null
          id: number
          last_attempt_at: string | null
          last_error: string | null
          locked_until: string | null
          order_id: number
          payload: Json
          store_id: number
          type: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          delivered_at?: string | null
          id?: never
          last_attempt_at?: string | null
          last_error?: string | null
          locked_until?: string | null
          order_id: number
          payload?: Json
          store_id: number
          type: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          delivered_at?: string | null
          id?: never
          last_attempt_at?: string | null
          last_error?: string | null
          locked_until?: string | null
          order_id?: number
          payload?: Json
          store_id?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_options: {
        Row: {
          group_snapshot: string | null
          id: number
          name_snapshot: string
          option_id: number | null
          order_item_id: number
          price_delta_cents: number
        }
        Insert: {
          group_snapshot?: string | null
          id?: never
          name_snapshot: string
          option_id?: number | null
          order_item_id: number
          price_delta_cents?: number
        }
        Update: {
          group_snapshot?: string | null
          id?: never
          name_snapshot?: string
          option_id?: number | null
          order_item_id?: number
          price_delta_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_options_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_options_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: number
          name_snapshot: string
          notes: string | null
          order_id: number
          prep_minutes: number
          product_id: number | null
          quantity: number
          total_cents: number
          unit_price_cents: number
        }
        Insert: {
          id?: never
          name_snapshot: string
          notes?: string | null
          order_id: number
          prep_minutes?: number
          product_id?: number | null
          quantity: number
          total_cents: number
          unit_price_cents: number
        }
        Update: {
          id?: never
          name_snapshot?: string
          notes?: string | null
          order_id?: number
          prep_minutes?: number
          product_id?: number | null
          quantity?: number
          total_cents?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          assigned_at: string | null
          base_prep_minutes: number | null
          cancelled_at: string | null
          confirmed_at: string | null
          courier_id: number | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string
          customer_phone_e164: string
          delivered_at: string | null
          delivery_address_between: string | null
          delivery_address_line: string | null
          delivery_address_notes: string | null
          delivery_address_unit: string | null
          delivery_fee_cents: number
          delivery_method: string
          delivery_minutes: number | null
          demand_multiplier: number | null
          eta_at: string | null
          eta_minutes: number | null
          external_ref: string | null
          external_synced_at: string | null
          fire_at: string | null
          id: number
          idempotency_key: string
          needs_refund_at: string | null
          notes: string | null
          on_the_way_at: string | null
          paid_at: string | null
          payment_method: string
          payment_provider: string
          payment_ref: string | null
          payment_status: string
          preference_expires_at: string | null
          preference_id: string | null
          public_token: string
          ready_at: string | null
          refund_reason: string | null
          refunded_at: string | null
          scheduled_for: string | null
          scheduled_night: string | null
          short_code: string
          status: string
          store_id: number
          subtotal_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          base_prep_minutes?: number | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          courier_id?: number | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name: string
          customer_phone_e164: string
          delivered_at?: string | null
          delivery_address_between?: string | null
          delivery_address_line?: string | null
          delivery_address_notes?: string | null
          delivery_address_unit?: string | null
          delivery_fee_cents?: number
          delivery_method?: string
          delivery_minutes?: number | null
          demand_multiplier?: number | null
          eta_at?: string | null
          eta_minutes?: number | null
          external_ref?: string | null
          external_synced_at?: string | null
          fire_at?: string | null
          id?: never
          idempotency_key: string
          needs_refund_at?: string | null
          notes?: string | null
          on_the_way_at?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_provider?: string
          payment_ref?: string | null
          payment_status?: string
          preference_expires_at?: string | null
          preference_id?: string | null
          public_token?: string
          ready_at?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          scheduled_for?: string | null
          scheduled_night?: string | null
          short_code: string
          status?: string
          store_id: number
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          base_prep_minutes?: number | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          courier_id?: number | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone_e164?: string
          delivered_at?: string | null
          delivery_address_between?: string | null
          delivery_address_line?: string | null
          delivery_address_notes?: string | null
          delivery_address_unit?: string | null
          delivery_fee_cents?: number
          delivery_method?: string
          delivery_minutes?: number | null
          demand_multiplier?: number | null
          eta_at?: string | null
          eta_minutes?: number | null
          external_ref?: string | null
          external_synced_at?: string | null
          fire_at?: string | null
          id?: never
          idempotency_key?: string
          needs_refund_at?: string | null
          notes?: string | null
          on_the_way_at?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_provider?: string
          payment_ref?: string | null
          payment_status?: string
          preference_expires_at?: string | null
          preference_id?: string | null
          public_token?: string
          ready_at?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          scheduled_for?: string | null
          scheduled_night?: string | null
          short_code?: string
          status?: string
          store_id?: number
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "store_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string | null
          id: number
          live_mode: boolean | null
          order_id: number
          provider: string
          provider_payment_id: string
          raw: Json
          status: string
          store_id: number
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string | null
          id?: never
          live_mode?: boolean | null
          order_id: number
          provider?: string
          provider_payment_id: string
          raw?: Json
          status: string
          store_id: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string | null
          id?: never
          live_mode?: boolean | null
          order_id?: number
          provider?: string
          provider_payment_id?: string
          raw?: Json
          status?: string
          store_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          id: number
          ip: unknown
          payload: Json
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: never
          ip?: unknown
          payload?: Json
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: never
          ip?: unknown
          payload?: Json
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      pos_endpoints: {
        Row: {
          created_at: string
          events: string[]
          id: number
          is_active: boolean
          name: string
          secret: string
          store_id: number
          url: string
        }
        Insert: {
          created_at?: string
          events?: string[]
          id?: never
          is_active?: boolean
          name: string
          secret: string
          store_id: number
          url: string
        }
        Update: {
          created_at?: string
          events?: string[]
          id?: never
          is_active?: boolean
          name?: string
          secret?: string
          store_id?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_endpoints_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: number | null
          created_at: string
          description: string | null
          id: number
          image_path: string | null
          is_available: boolean
          name: string
          position: number
          prep_minutes: number
          price_cents: number
          store_id: number
          updated_at: string
        }
        Insert: {
          category_id?: number | null
          created_at?: string
          description?: string | null
          id?: never
          image_path?: string | null
          is_available?: boolean
          name: string
          position?: number
          prep_minutes?: number
          price_cents: number
          store_id: number
          updated_at?: string
        }
        Update: {
          category_id?: number | null
          created_at?: string
          description?: string | null
          id?: never
          image_path?: string | null
          is_available?: boolean
          name?: string
          position?: number
          prep_minutes?: number
          price_cents?: number
          store_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_same_store_fkey"
            columns: ["store_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["store_id", "id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      signup_allowlist: {
        Row: {
          created_at: string
          email: string
          note: string | null
          provider: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
          provider: string
          role: string
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
          provider?: string
          role?: string
        }
        Relationships: []
      }
      store_branding: {
        Row: {
          color_accent: string
          color_background: string
          color_foreground: string
          color_primary: string
          color_primary_foreground: string
          density: string
          favicon_url: string | null
          font_body: string
          font_heading: string
          hero_image_url: string | null
          logo_dark_url: string | null
          logo_url: string | null
          radius_rem: number
          store_id: number
          theme_mode: string
          updated_at: string
        }
        Insert: {
          color_accent?: string
          color_background?: string
          color_foreground?: string
          color_primary?: string
          color_primary_foreground?: string
          density?: string
          favicon_url?: string | null
          font_body?: string
          font_heading?: string
          hero_image_url?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          radius_rem?: number
          store_id: number
          theme_mode?: string
          updated_at?: string
        }
        Update: {
          color_accent?: string
          color_background?: string
          color_foreground?: string
          color_primary?: string
          color_primary_foreground?: string
          density?: string
          favicon_url?: string | null
          font_body?: string
          font_heading?: string
          hero_image_url?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          radius_rem?: number
          store_id?: number
          theme_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_branding_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_hours: {
        Row: {
          created_at: string
          day_of_week: number
          duration_minutes: number
          id: number
          opens_at_minute: number
          store_id: number
        }
        Insert: {
          created_at?: string
          day_of_week: number
          duration_minutes: number
          id?: never
          opens_at_minute: number
          store_id: number
        }
        Update: {
          created_at?: string
          day_of_week?: number
          duration_minutes?: number
          id?: never
          opens_at_minute?: number
          store_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_hours_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_hours_overrides: {
        Row: {
          created_at: string
          duration_minutes: number | null
          id: number
          is_closed: boolean
          on_date: string
          opens_at_minute: number | null
          store_id: number
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          id?: never
          is_closed?: boolean
          on_date: string
          opens_at_minute?: number | null
          store_id: number
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          id?: never
          is_closed?: boolean
          on_date?: string
          opens_at_minute?: number | null
          store_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_hours_overrides_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_members: {
        Row: {
          created_at: string
          display_name: string | null
          id: number
          invited_at: string | null
          is_active: boolean
          role: string
          store_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: never
          invited_at?: string | null
          is_active?: boolean
          role?: string
          store_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: never
          invited_at?: string | null
          is_active?: boolean
          role?: string
          store_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_members_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_payment_credentials: {
        Row: {
          access_token: string | null
          connected_at: string | null
          is_sandbox: boolean
          provider: string
          public_key: string | null
          store_id: number
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          access_token?: string | null
          connected_at?: string | null
          is_sandbox?: boolean
          provider?: string
          public_key?: string | null
          store_id: number
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          access_token?: string | null
          connected_at?: string | null
          is_sandbox?: boolean
          provider?: string
          public_key?: string | null
          store_id?: number
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_payment_credentials_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_pending_changes: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: number
          kind: string
          payload: Json
          requested_by: string
          store_id: number
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: never
          kind: string
          payload: Json
          requested_by: string
          store_id: number
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: never
          kind?: string
          payload?: Json
          requested_by?: string
          store_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_pending_changes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          accepting_orders: boolean
          address: string | null
          auto_ready_orders: boolean
          auto_start_orders: boolean
          courier_collects_payment: boolean
          created_at: string
          currency: string
          delivery_busy_minutes: number
          delivery_enabled: boolean
          delivery_fee_cents: number
          delivery_free_from_cents: number
          delivery_min_order_cents: number
          delivery_minutes: number
          demand_multiplier: number
          demand_threshold_orders: number
          description: string | null
          id: number
          in_store_payment_enabled: boolean
          instagram_handle: string | null
          latitude: number | null
          longitude: number | null
          maps_url: string | null
          min_order_cents: number
          name: string
          online_payment_enabled: boolean
          pedidos_ya_url: string | null
          phone_e164: string | null
          rappi_url: string | null
          scheduled_capacity_per_night: number | null
          scheduled_delivery_enabled: boolean
          slug: string
          status: string
          timezone: string
          uber_eats_url: string | null
          updated_at: string
          whatsapp_phone_e164: string | null
        }
        Insert: {
          accepting_orders?: boolean
          address?: string | null
          auto_ready_orders?: boolean
          auto_start_orders?: boolean
          courier_collects_payment?: boolean
          created_at?: string
          currency?: string
          delivery_busy_minutes?: number
          delivery_enabled?: boolean
          delivery_fee_cents?: number
          delivery_free_from_cents?: number
          delivery_min_order_cents?: number
          delivery_minutes?: number
          demand_multiplier?: number
          demand_threshold_orders?: number
          description?: string | null
          id?: never
          in_store_payment_enabled?: boolean
          instagram_handle?: string | null
          latitude?: number | null
          longitude?: number | null
          maps_url?: string | null
          min_order_cents?: number
          name: string
          online_payment_enabled?: boolean
          pedidos_ya_url?: string | null
          phone_e164?: string | null
          rappi_url?: string | null
          scheduled_capacity_per_night?: number | null
          scheduled_delivery_enabled?: boolean
          slug: string
          status?: string
          timezone?: string
          uber_eats_url?: string | null
          updated_at?: string
          whatsapp_phone_e164?: string | null
        }
        Update: {
          accepting_orders?: boolean
          address?: string | null
          auto_ready_orders?: boolean
          auto_start_orders?: boolean
          courier_collects_payment?: boolean
          created_at?: string
          currency?: string
          delivery_busy_minutes?: number
          delivery_enabled?: boolean
          delivery_fee_cents?: number
          delivery_free_from_cents?: number
          delivery_min_order_cents?: number
          delivery_minutes?: number
          demand_multiplier?: number
          demand_threshold_orders?: number
          description?: string | null
          id?: never
          in_store_payment_enabled?: boolean
          instagram_handle?: string | null
          latitude?: number | null
          longitude?: number | null
          maps_url?: string | null
          min_order_cents?: number
          name?: string
          online_payment_enabled?: boolean
          pedidos_ya_url?: string | null
          phone_e164?: string | null
          rappi_url?: string | null
          scheduled_capacity_per_night?: number | null
          scheduled_delivery_enabled?: boolean
          slug?: string
          status?: string
          timezone?: string
          uber_eats_url?: string | null
          updated_at?: string
          whatsapp_phone_e164?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_auto_orders: { Args: never; Returns: Json }
      cancel_scheduled_orders: {
        Args: { p_night: string; p_pause?: boolean; p_store_id: number }
        Returns: Json
      }
      claim_event_deliveries: {
        Args: {
          p_limit?: number
          p_lock_seconds?: number
          p_max_attempts?: number
        }
        Returns: {
          attempts: number
          delivery_id: number
          endpoint_id: number
          endpoint_secret: string
          endpoint_url: string
          event_created_at: string
          event_id: number
          event_type: string
          order_id: number
          payload: Json
          store_id: number
        }[]
      }
      claim_order_events: {
        Args: {
          p_limit?: number
          p_lock_seconds?: number
          p_max_attempts?: number
        }
        Returns: {
          attempts: number
          created_at: string
          dead_at: string | null
          delivered_at: string | null
          id: number
          last_attempt_at: string | null
          last_error: string | null
          locked_until: string | null
          order_id: number
          payload: Json
          store_id: number
          type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "order_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_store_pending_change: {
        Args: { p_id: number; p_store_id: number; p_user_id: string }
        Returns: {
          attempts: number
          code_hash: string
          kind: string
          payload: Json
        }[]
      }
      cleanup_old_records: {
        Args: { p_audit_days?: number; p_event_days?: number }
        Returns: Json
      }
      consume_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_subject: string
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          count: number
          retry_after_seconds: number
        }[]
      }
      courier_advance_order: {
        Args: { p_collected?: boolean; p_order_id: number; p_status: string }
        Returns: undefined
      }
      courier_queue: { Args: never; Returns: Json }
      create_order: { Args: { p_items: Json; p_order: Json }; Returns: number }
      delete_store_hours_override: {
        Args: { p_on_date: string; p_store_id: number }
        Returns: undefined
      }
      expire_pending_orders: { Args: { p_minutes?: number }; Returns: number }
      platform_metrics: { Args: never; Returns: Json }
      platform_stores: { Args: { p_store_id?: number }; Returns: Json }
      set_store_hours: {
        Args: { p_ranges: Json; p_store_id: number }
        Returns: undefined
      }
      set_store_hours_override: {
        Args: {
          p_is_closed: boolean
          p_on_date: string
          p_ranges?: Json
          p_store_id: number
        }
        Returns: undefined
      }
      settle_event_delivery: {
        Args: {
          p_delivered: boolean
          p_delivery_id: number
          p_error?: string
          p_max_attempts?: number
        }
        Returns: undefined
      }
      settle_order_event: {
        Args: {
          p_delivered: boolean
          p_error?: string
          p_event_id: number
          p_max_attempts?: number
        }
        Returns: undefined
      }
      store_courier_availability: {
        Args: { p_store_id: number }
        Returns: Json
      }
      store_couriers: { Args: { p_store_id: number }; Returns: Json }
      store_dashboard: {
        Args: { p_days?: number; p_store_id: number }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

