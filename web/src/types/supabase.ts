export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.1';
  };
  public: {
    Tables: {
      agent_conversations: {
        Row: {
          id: string;
          user_id: string;
          organization_id: string;
          brand_id: string | null;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          organization_id: string;
          brand_id?: string | null;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          organization_id?: string;
          brand_id?: string | null;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      agent_messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: 'user' | 'assistant' | 'tool';
          content: string;
          tool_calls: Json | null;
          tool_call_id: string | null;
          tool_name: string | null;
          tool_result: Json | null;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: 'user' | 'assistant' | 'tool';
          content?: string;
          tool_calls?: Json | null;
          tool_call_id?: string | null;
          tool_name?: string | null;
          tool_result?: Json | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: 'user' | 'assistant' | 'tool';
          content?: string;
          tool_calls?: Json | null;
          tool_call_id?: string | null;
          tool_name?: string | null;
          tool_result?: Json | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_token_usage: {
        Row: {
          id: string;
          user_id: string;
          organization_id: string;
          year_month: string;
          prompt_tokens: number;
          completion_tokens: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          organization_id: string;
          year_month: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          organization_id?: string;
          year_month?: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      api_keys: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          prefix: string;
          key_hash: string;
          last_used_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          prefix: string;
          key_hash: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          prefix?: string;
          key_hash?: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_traffic_logs: {
        Row: {
          brand_id: string;
          country: string | null;
          created_at: string;
          id: string;
          ip_address: string | null;
          language: string | null;
          referrer: string | null;
          screen: string | null;
          source_platform: string | null;
          url: string;
          user_agent: string | null;
        };
        Insert: {
          brand_id: string;
          country?: string | null;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          language?: string | null;
          referrer?: string | null;
          screen?: string | null;
          source_platform?: string | null;
          url: string;
          user_agent?: string | null;
        };
        Update: {
          brand_id?: string;
          country?: string | null;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          language?: string | null;
          referrer?: string | null;
          screen?: string | null;
          source_platform?: string | null;
          url?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_traffic_logs_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_domains: {
        Row: {
          brand_id: string;
          country: string | null;
          created_at: string;
          domain: string;
          id: string;
          is_primary: boolean;
        };
        Insert: {
          brand_id: string;
          country?: string | null;
          created_at?: string;
          domain: string;
          id?: string;
          is_primary?: boolean;
        };
        Update: {
          brand_id?: string;
          country?: string | null;
          created_at?: string;
          domain?: string;
          id?: string;
          is_primary?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'brand_domains_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      brand_platforms: {
        Row: {
          api_model: string | null;
          brand_id: string;
          check_frequency: string;
          created_at: string;
          id: string;
          is_enabled: boolean;
          last_checked_at: string | null;
          platform: string;
          updated_at: string;
        };
        Insert: {
          api_model?: string | null;
          brand_id: string;
          check_frequency?: string;
          created_at?: string;
          id?: string;
          is_enabled?: boolean;
          last_checked_at?: string | null;
          platform: string;
          updated_at?: string;
        };
        Update: {
          api_model?: string | null;
          brand_id?: string;
          check_frequency?: string;
          created_at?: string;
          id?: string;
          is_enabled?: boolean;
          last_checked_at?: string | null;
          platform?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brand_platforms_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      brands: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          industry: string | null;
          is_active: boolean;
          language: string | null;
          logo_url: string | null;
          name: string;
          organization_id: string;
          region: string | null;
          shopping_mode_enabled: boolean;
          slug: string;
          tracking_code: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          industry?: string | null;
          is_active?: boolean;
          language?: string | null;
          logo_url?: string | null;
          name: string;
          organization_id: string;
          region?: string | null;
          shopping_mode_enabled?: boolean;
          slug: string;
          tracking_code?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          industry?: string | null;
          is_active?: boolean;
          language?: string | null;
          logo_url?: string | null;
          name?: string;
          organization_id?: string;
          region?: string | null;
          shopping_mode_enabled?: boolean;
          slug?: string;
          tracking_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brands_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      competitors: {
        Row: {
          brand_id: string;
          created_at: string;
          domain: string;
          id: string;
          name: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          domain?: string;
          id?: string;
          name: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          domain?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'competitors_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      content_opportunities: {
        Row: {
          brand_id: string;
          created_at: string | null;
          description: string | null;
          id: string;
          impact: string;
          opportunity_score: number | null;
          prompt_id: string | null;
          source_data: Json | null;
          status: string;
          title: string;
          type: string;
          updated_at: string | null;
          webhook_response: Json | null;
          webhook_sent_at: string | null;
        };
        Insert: {
          brand_id: string;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          impact?: string;
          opportunity_score?: number | null;
          prompt_id?: string | null;
          source_data?: Json | null;
          status?: string;
          title: string;
          type?: string;
          updated_at?: string | null;
          webhook_response?: Json | null;
          webhook_sent_at?: string | null;
        };
        Update: {
          brand_id?: string;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          impact?: string;
          opportunity_score?: number | null;
          prompt_id?: string | null;
          source_data?: Json | null;
          status?: string;
          title?: string;
          type?: string;
          updated_at?: string | null;
          webhook_response?: Json | null;
          webhook_sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'content_opportunities_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_opportunities_prompt_id_fkey';
            columns: ['prompt_id'];
            isOneToOne: false;
            referencedRelation: 'prompts';
            referencedColumns: ['id'];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          organization_id: string;
          role: Database['public']['Enums']['user_role'];
          status: Database['public']['Enums']['invitation_status'];
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          organization_id: string;
          role?: Database['public']['Enums']['user_role'];
          status?: Database['public']['Enums']['invitation_status'];
          token: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          organization_id?: string;
          role?: Database['public']['Enums']['user_role'];
          status?: Database['public']['Enums']['invitation_status'];
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          plan: string;
          plan_overrides: Record<string, unknown> | null;
          slug: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_ends_at: string | null;
          subscription_status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          plan?: string;
          plan_overrides?: Record<string, unknown> | null;
          slug: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_ends_at?: string | null;
          subscription_status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          plan?: string;
          plan_overrides?: Record<string, unknown> | null;
          slug?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_ends_at?: string | null;
          subscription_status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          onboarding_completed: boolean;
          organization_id: string | null;
          role: Database['public']['Enums']['user_role'];
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          onboarding_completed?: boolean;
          organization_id?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          onboarding_completed?: boolean;
          organization_id?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_result_shopping_cards: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          image_url: string | null;
          matched_brand_id: string | null;
          matched_brand_role: string;
          merchant_domain: string | null;
          merchant_url: string | null;
          platform: string;
          position: number;
          price_amount: number | null;
          price_currency: string | null;
          product_brand: string | null;
          product_title: string | null;
          prompt_result_id: string;
          rating: number | null;
          raw: Json;
          region: string | null;
          review_count: number | null;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          matched_brand_id?: string | null;
          matched_brand_role?: string;
          merchant_domain?: string | null;
          merchant_url?: string | null;
          platform: string;
          position: number;
          price_amount?: number | null;
          price_currency?: string | null;
          product_brand?: string | null;
          product_title?: string | null;
          prompt_result_id: string;
          rating?: number | null;
          raw: Json;
          region?: string | null;
          review_count?: number | null;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          matched_brand_id?: string | null;
          matched_brand_role?: string;
          merchant_domain?: string | null;
          merchant_url?: string | null;
          platform?: string;
          position?: number;
          price_amount?: number | null;
          price_currency?: string | null;
          product_brand?: string | null;
          product_title?: string | null;
          prompt_result_id?: string;
          rating?: number | null;
          raw?: Json;
          region?: string | null;
          review_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_result_shopping_cards_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'prompt_result_shopping_cards_prompt_result_id_fkey';
            columns: ['prompt_result_id'];
            isOneToOne: false;
            referencedRelation: 'prompt_results';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_results: {
        Row: {
          brand_id: string;
          citation_count: number;
          citations: Json;
          competitor_mentions: Json;
          created_at: string;
          id: string;
          inline_products: Json;
          mention_count: number;
          model_used: string | null;
          platform: string;
          prompt_id: string;
          region: string | null;
          response: string;
          search_queries: Json;
          sentiment: string;
          shopping_cards: Json;
          visibility_score: number;
        };
        Insert: {
          brand_id: string;
          citation_count?: number;
          citations?: Json;
          competitor_mentions?: Json;
          created_at?: string;
          id?: string;
          inline_products?: Json;
          mention_count?: number;
          model_used?: string | null;
          platform: string;
          prompt_id: string;
          region?: string | null;
          response?: string;
          search_queries?: Json;
          sentiment?: string;
          shopping_cards?: Json;
          visibility_score?: number;
        };
        Update: {
          brand_id?: string;
          citation_count?: number;
          citations?: Json;
          competitor_mentions?: Json;
          created_at?: string;
          id?: string;
          inline_products?: Json;
          mention_count?: number;
          model_used?: string | null;
          platform?: string;
          prompt_id?: string;
          region?: string | null;
          response?: string;
          search_queries?: Json;
          sentiment?: string;
          shopping_cards?: Json;
          visibility_score?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_results_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'prompt_results_prompt_id_fkey';
            columns: ['prompt_id'];
            isOneToOne: false;
            referencedRelation: 'prompts';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_sets: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_sets_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_suggestions: {
        Row: {
          added_prompt_id: string | null;
          brand_id: string;
          created_at: string;
          est_volume: number | null;
          expires_at: string;
          generated_at: string;
          id: string;
          reason: string | null;
          source: string;
          status: string;
          suggested_text: string;
          topic_id: string | null;
          topic_name: string | null;
          updated_at: string;
        };
        Insert: {
          added_prompt_id?: string | null;
          brand_id: string;
          created_at?: string;
          est_volume?: number | null;
          expires_at?: string;
          generated_at?: string;
          id?: string;
          reason?: string | null;
          source?: string;
          status?: string;
          suggested_text: string;
          topic_id?: string | null;
          topic_name?: string | null;
          updated_at?: string;
        };
        Update: {
          added_prompt_id?: string | null;
          brand_id?: string;
          created_at?: string;
          est_volume?: number | null;
          expires_at?: string;
          generated_at?: string;
          id?: string;
          reason?: string | null;
          source?: string;
          status?: string;
          suggested_text?: string;
          topic_id?: string | null;
          topic_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_suggestions_added_prompt_id_fkey';
            columns: ['added_prompt_id'];
            isOneToOne: false;
            referencedRelation: 'prompts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'prompt_suggestions_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'prompt_suggestions_topic_id_fkey';
            columns: ['topic_id'];
            isOneToOne: false;
            referencedRelation: 'topics';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_volumes: {
        Row: {
          ai_volume_multiplier: number;
          competition: string | null;
          competition_index: number | null;
          created_at: string | null;
          est_ai_volume: number;
          fetched_at: string | null;
          google_volumes: Json;
          id: string;
          intent: string;
          keywords: Json;
          language_code: string | null;
          location_code: number | null;
          prompt_id: string;
          total_google_volume: number;
        };
        Insert: {
          ai_volume_multiplier: number;
          competition?: string | null;
          competition_index?: number | null;
          created_at?: string | null;
          est_ai_volume: number;
          fetched_at?: string | null;
          google_volumes: Json;
          id?: string;
          intent: string;
          keywords: Json;
          language_code?: string | null;
          location_code?: number | null;
          prompt_id: string;
          total_google_volume: number;
        };
        Update: {
          ai_volume_multiplier?: number;
          competition?: string | null;
          competition_index?: number | null;
          created_at?: string | null;
          est_ai_volume?: number;
          fetched_at?: string | null;
          google_volumes?: Json;
          id?: string;
          intent?: string;
          keywords?: Json;
          language_code?: string | null;
          location_code?: number | null;
          prompt_id?: string;
          total_google_volume?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_volumes_prompt_id_fkey';
            columns: ['prompt_id'];
            isOneToOne: true;
            referencedRelation: 'prompts';
            referencedColumns: ['id'];
          },
        ];
      };
      prompts: {
        Row: {
          category: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          models: string[];
          platforms: string[];
          prompt_set_id: string;
          regions: string[];
          text: string;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          models?: string[];
          platforms?: string[];
          prompt_set_id: string;
          regions?: string[];
          text: string;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          models?: string[];
          platforms?: string[];
          prompt_set_id?: string;
          regions?: string[];
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prompts_prompt_set_id_fkey';
            columns: ['prompt_set_id'];
            isOneToOne: false;
            referencedRelation: 'prompt_sets';
            referencedColumns: ['id'];
          },
        ];
      };
      reports: {
        Row: {
          brand_id: string;
          created_at: string;
          created_by: string | null;
          date_from: string;
          date_to: string;
          id: string;
          payload: Json;
          template: string;
          title: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          created_by?: string | null;
          date_from: string;
          date_to: string;
          id?: string;
          payload?: Json;
          template?: string;
          title: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          created_by?: string | null;
          date_from?: string;
          date_to?: string;
          id?: string;
          payload?: Json;
          template?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reports_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      topics: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'topics_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      webhook_configs: {
        Row: {
          brand_id: string;
          created_at: string | null;
          events: string[] | null;
          id: string;
          is_active: boolean | null;
          name: string;
          updated_at: string | null;
          webhook_secret: string | null;
          webhook_url: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string | null;
          events?: string[] | null;
          id?: string;
          is_active?: boolean | null;
          name?: string;
          updated_at?: string | null;
          webhook_secret?: string | null;
          webhook_url: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string | null;
          events?: string[] | null;
          id?: string;
          is_active?: boolean | null;
          name?: string;
          updated_at?: string | null;
          webhook_secret?: string | null;
          webhook_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_configs_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_latest_prompt_results:
        | {
            Args: { p_brand_id: string; p_platform?: string };
            Returns: {
              brand_id: string;
              citation_count: number;
              citations: Json;
              competitor_mentions: Json;
              created_at: string;
              id: string;
              mention_count: number;
              model_used: string | null;
              platform: string;
              prompt_id: string;
              region: string | null;
              response: string;
              sentiment: string;
              visibility_score: number;
            }[];
            SetofOptions: {
              from: '*';
              to: 'prompt_results';
              isOneToOne: false;
              isSetofReturn: true;
            };
          }
        | {
            Args: {
              p_brand_id: string;
              p_date_from?: string;
              p_date_to?: string;
              p_model?: string;
              p_platform?: string;
              p_region?: string;
            };
            Returns: {
              brand_id: string;
              citation_count: number;
              citations: Json;
              competitor_mentions: Json;
              created_at: string;
              id: string;
              mention_count: number;
              model_used: string | null;
              platform: string;
              prompt_id: string;
              region: string | null;
              response: string;
              sentiment: string;
              visibility_score: number;
            }[];
            SetofOptions: {
              from: '*';
              to: 'prompt_results';
              isOneToOne: false;
              isSetofReturn: true;
            };
          };
      insights_aggregates: {
        Args: {
          p_brand_id: string;
          p_platform?: string | null;
          p_models?: string[] | null;
          p_region?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
          p_prompt_id?: string | null;
          p_topic_id?: string | null;
        };
        Returns: Json;
      };
      competitor_aggregates: {
        Args: {
          p_brand_id: string;
          p_platform?: string | null;
          p_models?: string[] | null;
          p_region?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
          p_prompt_id?: string | null;
          p_topic_id?: string | null;
        };
        Returns: Json;
      };
      visibility_trend_aggregates: {
        Args: {
          p_brand_id: string;
          p_models?: string[] | null;
          p_region?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
          p_topic_id?: string | null;
          p_granularity?: string | null;
        };
        Returns: Json;
      };
      share_of_voice_aggregates: {
        Args: {
          p_brand_id: string;
          p_platform?: string | null;
          p_models?: string[] | null;
          p_region?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
          p_prompt_id?: string | null;
          p_topic_id?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      invitation_status: 'pending' | 'accepted' | 'expired' | 'revoked';
      user_role: 'admin' | 'manager' | 'analyst' | 'agency_partner';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      invitation_status: ['pending', 'accepted', 'expired', 'revoked'],
      user_role: ['admin', 'manager', 'analyst', 'agency_partner'],
    },
  },
} as const;
