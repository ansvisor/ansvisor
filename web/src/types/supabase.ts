export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      agent_conversations: {
        Row: {
          brand_id: string | null
          created_at: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          completion_tokens: number | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          prompt_tokens: number | null
          role: string
          tool_call_id: string | null
          tool_calls: Json | null
          tool_name: string | null
          tool_result: Json | null
        }
        Insert: {
          completion_tokens?: number | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          prompt_tokens?: number | null
          role: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
        }
        Update: {
          completion_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          prompt_tokens?: number | null
          role?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_token_usage: {
        Row: {
          completion_tokens: number
          created_at: string
          id: string
          organization_id: string
          prompt_tokens: number
          updated_at: string
          user_id: string
          year_month: string
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          id?: string
          organization_id: string
          prompt_tokens?: number
          updated_at?: string
          user_id: string
          year_month: string
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          id?: string
          organization_id?: string
          prompt_tokens?: number
          updated_at?: string
          user_id?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_token_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_traffic_logs: {
        Row: {
          brand_id: string
          country: string | null
          created_at: string
          id: string
          ip_address: string | null
          language: string | null
          referrer: string | null
          screen: string | null
          source_platform: string | null
          url: string
          user_agent: string | null
        }
        Insert: {
          brand_id: string
          country?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          language?: string | null
          referrer?: string | null
          screen?: string | null
          source_platform?: string | null
          url: string
          user_agent?: string | null
        }
        Update: {
          brand_id?: string
          country?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          language?: string | null
          referrer?: string | null
          screen?: string | null
          source_platform?: string | null
          url?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_traffic_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_signal_results: {
        Row: {
          audit_id: string
          category: string | null
          created_at: string
          evidence: Json
          id: string
          score: number | null
          signal_key: string
          status: string
        }
        Insert: {
          audit_id: string
          category?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          score?: number | null
          signal_key: string
          status: string
        }
        Update: {
          audit_id?: string
          category?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          score?: number | null
          signal_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_signal_results_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "site_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_domains: {
        Row: {
          brand_id: string
          country: string | null
          created_at: string
          domain: string
          id: string
          is_primary: boolean
        }
        Insert: {
          brand_id: string
          country?: string | null
          created_at?: string
          domain: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          brand_id?: string
          country?: string | null
          created_at?: string
          domain?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "brand_domains_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_platforms: {
        Row: {
          api_model: string | null
          brand_id: string
          check_frequency: string
          created_at: string
          id: string
          is_enabled: boolean
          last_checked_at: string | null
          platform: string
          updated_at: string
        }
        Insert: {
          api_model?: string | null
          brand_id: string
          check_frequency?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_checked_at?: string | null
          platform: string
          updated_at?: string
        }
        Update: {
          api_model?: string | null
          brand_id?: string
          check_frequency?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_checked_at?: string | null
          platform?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_platforms_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          description: string | null
          ga_property_id: string | null
          gsc_property: string | null
          id: string
          industry: string | null
          is_active: boolean
          language: string | null
          logo_url: string | null
          name: string
          organization_id: string
          region: string | null
          shopping_mode_enabled: boolean
          slug: string
          state: string | null
          tracking_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          ga_property_id?: string | null
          gsc_property?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          language?: string | null
          logo_url?: string | null
          name: string
          organization_id: string
          region?: string | null
          shopping_mode_enabled?: boolean
          slug: string
          state?: string | null
          tracking_code?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          ga_property_id?: string | null
          gsc_property?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          language?: string | null
          logo_url?: string | null
          name?: string
          organization_id?: string
          region?: string | null
          shopping_mode_enabled?: boolean
          slug?: string
          state?: string | null
          tracking_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_usage: {
        Row: {
          created_at: string | null
          id: string
          opportunity_id: string | null
          organization_id: string
          used_at: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          organization_id: string
          used_at?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          organization_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_usage_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cloro_pending_tasks: {
        Row: {
          brand_id: string
          prompt_id: string
          region: string | null
          scraper_id: string
          submitted_at: string
          task_id: string
        }
        Insert: {
          brand_id: string
          prompt_id: string
          region?: string | null
          scraper_id: string
          submitted_at?: string
          task_id: string
        }
        Update: {
          brand_id?: string
          prompt_id?: string
          region?: string | null
          scraper_id?: string
          submitted_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloro_pending_tasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloro_pending_tasks_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          brand_id: string
          created_at: string
          domain: string
          id: string
          name: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          domain?: string
          id?: string
          name: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          domain?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      content_opportunities: {
        Row: {
          brand_id: string
          brief: Json | null
          created_at: string | null
          description: string | null
          id: string
          impact: string
          opportunity_score: number | null
          prompt_id: string | null
          source_data: Json | null
          status: string
          title: string
          type: string
          updated_at: string | null
          webhook_response: Json | null
          webhook_sent_at: string | null
        }
        Insert: {
          brand_id: string
          brief?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          impact?: string
          opportunity_score?: number | null
          prompt_id?: string | null
          source_data?: Json | null
          status?: string
          title: string
          type?: string
          updated_at?: string | null
          webhook_response?: Json | null
          webhook_sent_at?: string | null
        }
        Update: {
          brand_id?: string
          brief?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          impact?: string
          opportunity_score?: number | null
          prompt_id?: string | null
          source_data?: Json | null
          status?: string
          title?: string
          type?: string
          updated_at?: string | null
          webhook_response?: Json | null
          webhook_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_opportunities_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      dataforseo_competition_cache: {
        Row: {
          competition: string | null
          competition_index: number | null
          fetched_at: string
          keyword: string
          language_code: string
          location_code: number
        }
        Insert: {
          competition?: string | null
          competition_index?: number | null
          fetched_at?: string
          keyword: string
          language_code?: string
          location_code?: number
        }
        Update: {
          competition?: string | null
          competition_index?: number | null
          fetched_at?: string
          keyword?: string
          language_code?: string
          location_code?: number
        }
        Relationships: []
      }
      fanout_query_intents: {
        Row: {
          created_at: string
          intent: string
          query: string
        }
        Insert: {
          created_at?: string
          intent: string
          query: string
        }
        Update: {
          created_at?: string
          intent?: string
          query?: string
        }
        Relationships: []
      }
      ga_ai_traffic_stats: {
        Row: {
          brand_id: string
          created_at: string
          date: string
          engaged_sessions: number
          engagement_duration_seconds: number
          id: string
          key_events: number
          landing_page: string
          landing_page_query: string
          platform: string | null
          purchase_revenue: number
          sessions: number
          source: string
          total_users: number
          transactions: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          date: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          landing_page_query?: string
          platform?: string | null
          purchase_revenue?: number
          sessions?: number
          source: string
          total_users?: number
          transactions?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          date?: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          landing_page_query?: string
          platform?: string | null
          purchase_revenue?: number
          sessions?: number
          source?: string
          total_users?: number
          transactions?: number
        }
        Relationships: [
          {
            foreignKeyName: "ga_ai_traffic_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ga_item_stats: {
        Row: {
          brand_id: string
          created_at: string
          date: string
          id: string
          item_category: string
          item_id: string
          item_name: string
          item_revenue: number
          items_added_to_cart: number
          items_purchased: number
          items_viewed: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          date: string
          id?: string
          item_category?: string
          item_id?: string
          item_name?: string
          item_revenue?: number
          items_added_to_cart?: number
          items_purchased?: number
          items_viewed?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          date?: string
          id?: string
          item_category?: string
          item_id?: string
          item_name?: string
          item_revenue?: number
          items_added_to_cart?: number
          items_purchased?: number
          items_viewed?: number
        }
        Relationships: [
          {
            foreignKeyName: "ga_item_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ga_page_stats: {
        Row: {
          brand_id: string
          created_at: string
          date: string
          engaged_sessions: number
          engagement_duration_seconds: number
          id: string
          key_events: number
          landing_page: string
          purchase_revenue: number
          sessions: number
          total_users: number
          transactions: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          date: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          purchase_revenue?: number
          sessions?: number
          total_users?: number
          transactions?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          date?: string
          engaged_sessions?: number
          engagement_duration_seconds?: number
          id?: string
          key_events?: number
          landing_page?: string
          purchase_revenue?: number
          sessions?: number
          total_users?: number
          transactions?: number
        }
        Relationships: [
          {
            foreignKeyName: "ga_page_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_query_stats: {
        Row: {
          brand_id: string
          clicks: number
          created_at: string
          ctr: number
          date: string
          id: string
          impressions: number
          position: number
          query: string
        }
        Insert: {
          brand_id: string
          clicks?: number
          created_at?: string
          ctr?: number
          date: string
          id?: string
          impressions?: number
          position?: number
          query: string
        }
        Update: {
          brand_id?: string
          clicks?: number
          created_at?: string
          ctr?: number
          date?: string
          id?: string
          impressions?: number
          position?: number
          query?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_query_stats_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          composio_account_id: string | null
          composio_entity_id: string
          connected_by: string | null
          created_at: string
          id: string
          organization_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          composio_account_id?: string | null
          composio_entity_id: string
          connected_by?: string | null
          created_at?: string
          id?: string
          organization_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          composio_account_id?: string | null
          composio_entity_id?: string
          connected_by?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          brand_id: string
          completed_at: string | null
          created_at: string
          data: Json
          failed_reason: string | null
          id: string
          max_attempts: number
          progress: Json | null
          result: Json | null
          started_at: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          brand_id: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          failed_reason?: string | null
          id?: string
          max_attempts?: number
          progress?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          brand_id?: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          failed_reason?: string | null
          id?: string
          max_attempts?: number
          progress?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          anthropic_api_key_encrypted: string | null
          anthropic_api_key_last4: string | null
          anthropic_api_key_set_at: string | null
          anthropic_api_key_set_by: string | null
          created_at: string
          id: string
          name: string
          plan: string
          plan_overrides: Json | null
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_ends_at: string | null
          subscription_status: string
          updated_at: string
        }
        Insert: {
          anthropic_api_key_encrypted?: string | null
          anthropic_api_key_last4?: string | null
          anthropic_api_key_set_at?: string | null
          anthropic_api_key_set_by?: string | null
          created_at?: string
          id?: string
          name: string
          plan?: string
          plan_overrides?: Json | null
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          anthropic_api_key_encrypted?: string | null
          anthropic_api_key_last4?: string | null
          anthropic_api_key_set_at?: string | null
          anthropic_api_key_set_by?: string | null
          created_at?: string
          id?: string
          name?: string
          plan?: string
          plan_overrides?: Json | null
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_anthropic_api_key_set_by_fkey"
            columns: ["anthropic_api_key_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_opportunities: {
        Row: {
          ai_platforms: string[]
          ai_sessions: number
          brand_id: string
          engaged_sessions: number
          engagement_seconds: number
          first_detected_at: string
          id: string
          key_events: number
          kind: string
          landing_page: string
          last_detected_at: string
          resolved_at: string | null
          revenue: number
          sessions: number
          transactions: number
          value_percentile: number
          value_rank: number
          value_signal: string
          window_days: number
        }
        Insert: {
          ai_platforms?: string[]
          ai_sessions?: number
          brand_id: string
          engaged_sessions?: number
          engagement_seconds?: number
          first_detected_at?: string
          id?: string
          key_events?: number
          kind: string
          landing_page: string
          last_detected_at?: string
          resolved_at?: string | null
          revenue?: number
          sessions?: number
          transactions?: number
          value_percentile: number
          value_rank: number
          value_signal: string
          window_days: number
        }
        Update: {
          ai_platforms?: string[]
          ai_sessions?: number
          brand_id?: string
          engaged_sessions?: number
          engagement_seconds?: number
          first_detected_at?: string
          id?: string
          key_events?: number
          kind?: string
          landing_page?: string
          last_detected_at?: string
          resolved_at?: string | null
          revenue?: number
          sessions?: number
          transactions?: number
          value_percentile?: number
          value_rank?: number
          value_signal?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "page_opportunities_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          onboarding_completed: boolean | null
          organization_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          onboarding_completed?: boolean | null
          organization_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean | null
          organization_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          prompt_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          prompt_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          prompt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_notes_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_result_shopping_cards: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          image_url: string | null
          matched_brand_id: string | null
          matched_brand_role: string
          merchant_domain: string | null
          merchant_url: string | null
          platform: string
          position: number
          price_amount: number | null
          price_currency: string | null
          product_brand: string | null
          product_title: string | null
          prompt_result_id: string
          rating: number | null
          raw: Json
          region: string | null
          review_count: number | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          matched_brand_id?: string | null
          matched_brand_role?: string
          merchant_domain?: string | null
          merchant_url?: string | null
          platform: string
          position: number
          price_amount?: number | null
          price_currency?: string | null
          product_brand?: string | null
          product_title?: string | null
          prompt_result_id: string
          rating?: number | null
          raw: Json
          region?: string | null
          review_count?: number | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          matched_brand_id?: string | null
          matched_brand_role?: string
          merchant_domain?: string | null
          merchant_url?: string | null
          platform?: string
          position?: number
          price_amount?: number | null
          price_currency?: string | null
          product_brand?: string | null
          product_title?: string | null
          prompt_result_id?: string
          rating?: number | null
          raw?: Json
          region?: string | null
          review_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_result_shopping_cards_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_result_shopping_cards_prompt_result_id_fkey"
            columns: ["prompt_result_id"]
            isOneToOne: false
            referencedRelation: "prompt_results"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_results: {
        Row: {
          brand_id: string
          citation_count: number
          citations: Json
          competitor_mentions: Json
          created_at: string
          id: string
          inline_products: Json
          mention_count: number
          mention_position: number | null
          mentioned_entity_count: number | null
          model_used: string | null
          platform: string
          prompt_id: string
          region: string | null
          response: string
          search_queries: Json
          sentiment: string
          shopping_cards: Json
          visibility_score: number
        }
        Insert: {
          brand_id: string
          citation_count?: number
          citations?: Json
          competitor_mentions?: Json
          created_at?: string
          id?: string
          inline_products?: Json
          mention_count?: number
          mention_position?: number | null
          mentioned_entity_count?: number | null
          model_used?: string | null
          platform: string
          prompt_id: string
          region?: string | null
          response?: string
          search_queries?: Json
          sentiment?: string
          shopping_cards?: Json
          visibility_score?: number
        }
        Update: {
          brand_id?: string
          citation_count?: number
          citations?: Json
          competitor_mentions?: Json
          created_at?: string
          id?: string
          inline_products?: Json
          mention_count?: number
          mention_position?: number | null
          mentioned_entity_count?: number | null
          model_used?: string | null
          platform?: string
          prompt_id?: string
          region?: string | null
          response?: string
          search_queries?: Json
          sentiment?: string
          shopping_cards?: Json
          visibility_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_results_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_results_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_sets: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_sets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_suggestions: {
        Row: {
          added_prompt_id: string | null
          brand_id: string
          created_at: string
          est_volume: number | null
          expires_at: string
          generated_at: string
          id: string
          reason: string | null
          source: string
          source_data: Json | null
          status: string
          suggested_text: string
          topic_id: string | null
          topic_name: string | null
          updated_at: string
        }
        Insert: {
          added_prompt_id?: string | null
          brand_id: string
          created_at?: string
          est_volume?: number | null
          expires_at?: string
          generated_at?: string
          id?: string
          reason?: string | null
          source?: string
          source_data?: Json | null
          status?: string
          suggested_text: string
          topic_id?: string | null
          topic_name?: string | null
          updated_at?: string
        }
        Update: {
          added_prompt_id?: string | null
          brand_id?: string
          created_at?: string
          est_volume?: number | null
          expires_at?: string
          generated_at?: string
          id?: string
          reason?: string | null
          source?: string
          source_data?: Json | null
          status?: string
          suggested_text?: string
          topic_id?: string | null
          topic_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_suggestions_added_prompt_id_fkey"
            columns: ["added_prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_suggestions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_suggestions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_target_urls: {
        Row: {
          added_by: string | null
          cited_count: number
          created_at: string
          first_cited_at: string | null
          id: string
          label: string | null
          last_cited_at: string | null
          prompt_id: string
          url: string
        }
        Insert: {
          added_by?: string | null
          cited_count?: number
          created_at?: string
          first_cited_at?: string | null
          id?: string
          label?: string | null
          last_cited_at?: string | null
          prompt_id: string
          url: string
        }
        Update: {
          added_by?: string | null
          cited_count?: number
          created_at?: string
          first_cited_at?: string | null
          id?: string
          label?: string | null
          last_cited_at?: string | null
          prompt_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_target_urls_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_target_urls_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_volumes: {
        Row: {
          ai_volume_multiplier: number
          competition: string | null
          competition_index: number | null
          created_at: string | null
          est_ai_volume: number
          fetched_at: string | null
          google_volumes: Json
          id: string
          intent: string
          keywords: Json
          language_code: string | null
          location_code: number | null
          prompt_id: string
          total_google_volume: number
        }
        Insert: {
          ai_volume_multiplier: number
          competition?: string | null
          competition_index?: number | null
          created_at?: string | null
          est_ai_volume: number
          fetched_at?: string | null
          google_volumes: Json
          id?: string
          intent: string
          keywords: Json
          language_code?: string | null
          location_code?: number | null
          prompt_id: string
          total_google_volume: number
        }
        Update: {
          ai_volume_multiplier?: number
          competition?: string | null
          competition_index?: number | null
          created_at?: string | null
          est_ai_volume?: number
          fetched_at?: string | null
          google_volumes?: Json
          id?: string
          intent?: string
          keywords?: Json
          language_code?: string | null
          location_code?: number | null
          prompt_id?: string
          total_google_volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_volumes_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: true
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          models: string[]
          platforms: string[]
          prompt_set_id: string
          regions: string[]
          text: string
          topic_id: string | null
          work_status: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          models?: string[]
          platforms?: string[]
          prompt_set_id: string
          regions?: string[]
          text: string
          topic_id?: string | null
          work_status?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          models?: string[]
          platforms?: string[]
          prompt_set_id?: string
          regions?: string[]
          text?: string
          topic_id?: string | null
          work_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompts_prompt_set_id_fkey"
            columns: ["prompt_set_id"]
            isOneToOne: false
            referencedRelation: "prompt_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_settings: {
        Row: {
          brand_id: string
          created_at: string
          frequency: string
          recipients: string[] | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          frequency?: string
          recipients?: string[] | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          frequency?: string
          recipients?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulse_settings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          date_from: string
          date_to: string
          id: string
          payload: Json
          template: string
          title: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          date_from: string
          date_to: string
          id?: string
          payload?: Json
          template?: string
          title: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          date_from?: string
          date_to?: string
          id?: string
          payload?: Json
          template?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sent_pulses: {
        Row: {
          brand_id: string
          created_at: string
          email_recipient_count: number
          email_sent: boolean
          frequency: string
          id: string
          payload: Json
          pulse_date: string
          warning_keys: string[]
          webhook_sent: boolean
        }
        Insert: {
          brand_id: string
          created_at?: string
          email_recipient_count?: number
          email_sent?: boolean
          frequency: string
          id?: string
          payload?: Json
          pulse_date: string
          warning_keys?: string[]
          webhook_sent?: boolean
        }
        Update: {
          brand_id?: string
          created_at?: string
          email_recipient_count?: number
          email_sent?: boolean
          frequency?: string
          id?: string
          payload?: Json
          pulse_date?: string
          warning_keys?: string[]
          webhook_sent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sent_pulses_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      site_audit_usage: {
        Row: {
          audit_id: string | null
          created_at: string | null
          id: string
          organization_id: string
          used_at: string
        }
        Insert: {
          audit_id?: string | null
          created_at?: string | null
          id?: string
          organization_id: string
          used_at?: string
        }
        Update: {
          audit_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_audit_usage_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "site_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_audit_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_audits: {
        Row: {
          brand_id: string
          category_scores: Json
          completed_at: string | null
          created_at: string
          error: string | null
          final_url: string | null
          id: string
          recommendations: Json
          rubric_version: string | null
          signals_evaluated: number | null
          signals_total: number | null
          status: string
          total_score: number | null
          url: string
        }
        Insert: {
          brand_id: string
          category_scores?: Json
          completed_at?: string | null
          created_at?: string
          error?: string | null
          final_url?: string | null
          id?: string
          recommendations?: Json
          rubric_version?: string | null
          signals_evaluated?: number | null
          signals_total?: number | null
          status?: string
          total_score?: number | null
          url: string
        }
        Update: {
          brand_id?: string
          category_scores?: Json
          completed_at?: string | null
          created_at?: string
          error?: string | null
          final_url?: string | null
          id?: string
          recommendations?: Json
          rubric_version?: string | null
          signals_evaluated?: number | null
          signals_total?: number | null
          status?: string
          total_score?: number | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_audits_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_suggestions: {
        Row: {
          added_topic_id: string | null
          brand_id: string
          created_at: string
          generated_at: string
          id: string
          name: string
          reason: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          added_topic_id?: string | null
          brand_id: string
          created_at?: string
          generated_at?: string
          id?: string
          name: string
          reason?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          added_topic_id?: string | null
          brand_id?: string
          created_at?: string
          generated_at?: string
          id?: string
          name?: string
          reason?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_suggestions_added_topic_id_fkey"
            columns: ["added_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_suggestions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          brand_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          brand_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          brand_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_runs: {
        Row: {
          brand_id: string
          completed_at: string | null
          created_at: string
          id: string
          result_count: number | null
          source: string
          started_at: string
        }
        Insert: {
          brand_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          result_count?: number | null
          source?: string
          started_at?: string
        }
        Update: {
          brand_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          result_count?: number | null
          source?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      volume_usage: {
        Row: {
          action: string
          created_at: string | null
          id: string
          organization_id: string
          prompt_count: number | null
          used_at: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          organization_id: string
          prompt_count?: number | null
          used_at?: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          organization_id?: string
          prompt_count?: number | null
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "volume_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_configs: {
        Row: {
          brand_id: string
          created_at: string | null
          events: string[] | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          webhook_secret: string | null
          webhook_url: string
        }
        Insert: {
          brand_id: string
          created_at?: string | null
          events?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          webhook_secret?: string | null
          webhook_url: string
        }
        Update: {
          brand_id?: string
          created_at?: string | null
          events?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          webhook_secret?: string | null
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_configs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_visibility_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      citations_domains: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          domain: string
          models: string[]
          results_citing: number
          total_citations: number
        }[]
      }
      citations_urls: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          domain: string
          models: string[]
          results_citing: number
          title: string
          total_citations: number
          total_urls: number
          url: string
        }[]
      }
      citations_window_stats: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_prompt_ids?: string[]
          p_regions?: string[]
          p_topic_ids?: string[]
        }
        Returns: {
          regions: string[]
          results: number
        }[]
      }
      competitor_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      get_latest_prompt_results:
        | {
            Args: { p_brand_id: string; p_platform?: string }
            Returns: {
              brand_id: string
              citation_count: number
              citations: Json
              competitor_mentions: Json
              created_at: string
              id: string
              inline_products: Json
              mention_count: number
              mention_position: number | null
              mentioned_entity_count: number | null
              model_used: string | null
              platform: string
              prompt_id: string
              region: string | null
              response: string
              search_queries: Json
              sentiment: string
              shopping_cards: Json
              visibility_score: number
            }[]
            SetofOptions: {
              from: "*"
              to: "prompt_results"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_brand_id: string
              p_date_from?: string
              p_date_to?: string
              p_model?: string
              p_platform?: string
              p_region?: string
            }
            Returns: {
              brand_id: string
              citation_count: number
              citations: Json
              competitor_mentions: Json
              created_at: string
              id: string
              inline_products: Json
              mention_count: number
              mention_position: number | null
              mentioned_entity_count: number | null
              model_used: string | null
              platform: string
              prompt_id: string
              region: string | null
              response: string
              search_queries: Json
              sentiment: string
              shopping_cards: Json
              visibility_score: number
            }[]
            SetofOptions: {
              from: "*"
              to: "prompt_results"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      gsc_candidate_queries: {
        Args: { p_brand_id: string; p_min_impressions: number; p_since: string }
        Returns: {
          avg_position: number
          clicks: number
          impressions: number
          query: string
        }[]
      }
      insights_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      insights_filter_options: {
        Args: { p_brand_id: string }
        Returns: {
          models: string[]
          regions: string[]
        }[]
      }
      prompt_performance_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      prompt_visibility_summaries: {
        Args: { p_brand_id: string; p_date_from?: string; p_date_to?: string }
        Returns: {
          avg_visibility: number
          avg_visibility_visible: number
          citation_answers: number
          last_run_at: string
          mention_answers: number
          position_factor: number
          prompt_id: string
          runs: number
          total_citations: number
          total_mentions: number
          visible_runs: number
        }[]
      }
      report_citation_evidence: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
          p_limit?: number
          p_prompts_per_url?: number
        }
        Returns: {
          domain: string
          sourced_prompts: string[]
          title: string
          total_citations: number
          url: string
        }[]
      }
      report_query_fanout_engines: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
        }
        Returns: {
          answers_with_fanout: number
          distinct_queries: number
          engine: string
        }[]
      }
      report_query_fanout: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
          p_limit?: number
        }
        Returns: {
          engines: string[]
          query: string
          times_searched: number
        }[]
      }
      report_prompt_performance: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
        }
        Returns: {
          citation_answers: number
          mention_answers: number
          pos_n: number
          pos_sum: number
          prompt_id: string
          prompt_text: string
          runs: number
          sum_visibility: number
          total_mentions: number
          visible_runs: number
        }[]
      }
      report_topic_performance: {
        Args: {
          p_brand_id: string
          p_date_from: string
          p_date_to: string
          p_prev_from: string
        }
        Returns: {
          citation_answers: number
          mention_answers: number
          pos_n: number
          pos_sum: number
          prev_citation_answers: number
          prev_mention_answers: number
          prev_pos_n: number
          prev_pos_sum: number
          prev_runs: number
          prev_visible_runs: number
          runs: number
          sum_visibility: number
          topic_id: string
          topic_name: string
          visible_runs: number
        }[]
      }
      share_of_voice_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_prompt_id?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      topics_overview_aggregates: {
        Args: { p_brand_id: string }
        Returns: {
          active_prompts: number
          answers: number
          citation_answers: number
          comp_mentions: number
          competitors: Json
          cur_answers: number
          cur_citation_answers: number
          cur_mention_answers: number
          cur_pos_n: number
          cur_pos_sum: number
          daily: Json
          last_run_at: string
          mention_answers: number
          pos_n: number
          pos_sum: number
          prev_answers: number
          prev_citation_answers: number
          prev_mention_answers: number
          prev_pos_n: number
          prev_pos_sum: number
          topic_id: string
          total_citations: number
          total_mentions: number
          visible_prompts: number
        }[]
      }
      tracked_prompt_count: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: number
      }
      visibility_rate_trend: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      visibility_trend_aggregates: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_granularity?: string
          p_models?: string[]
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
      visible_prompt_stats: {
        Args: {
          p_brand_id: string
          p_date_from?: string
          p_date_to?: string
          p_models?: string[]
          p_platform?: string
          p_region?: string
          p_topic_id?: string
        }
        Returns: Json
      }
    }
    Enums: {
      invitation_status: "pending" | "accepted" | "expired" | "revoked"
      user_role: "admin" | "manager" | "analyst" | "agency_partner"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      invitation_status: ["pending", "accepted", "expired", "revoked"],
      user_role: ["admin", "manager", "analyst", "agency_partner"],
    },
  },
} as const
