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
  public: {
    Tables: {
      characters: {
        Row: {
          id: string
          story_id: string
          name: string
          description: string | null
          physical_attributes: string | null
          clothing: string | null
          accessories: string | null
          personality: string | null
          image_url: string | null
          active_reference_sheet_id: string | null
          source: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          story_id: string
          name: string
          description?: string | null
          physical_attributes?: string | null
          clothing?: string | null
          accessories?: string | null
          personality?: string | null
          image_url?: string | null
          active_reference_sheet_id?: string | null
          source?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          story_id?: string
          name?: string
          description?: string | null
          physical_attributes?: string | null
          clothing?: string | null
          accessories?: string | null
          personality?: string | null
          image_url?: string | null
          active_reference_sheet_id?: string | null
          source?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "characters_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          }
        ]
      }
      character_asset_versions: {
        Row: {
          asset_type: string
          character_id: string
          created_at: string
          created_by: string | null
          id: string
          image_url: string | null
          metadata: Json
          parent_id: string | null
          prompt: string | null
          status: string
          story_id: string
          version: number
        }
        Insert: {
          asset_type: string
          character_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          metadata?: Json
          parent_id?: string | null
          prompt?: string | null
          status?: string
          story_id: string
          version: number
        }
        Update: {
          asset_type?: string
          character_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          metadata?: Json
          parent_id?: string | null
          prompt?: string | null
          status?: string
          story_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_asset_versions_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_asset_versions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "character_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_asset_versions_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      character_change_events: {
        Row: {
          character_id: string
          created_at: string
          event: Json
          from_scene_id: string | null
          id: string
          story_context: string | null
          story_id: string
          to_scene_id: string | null
        }
        Insert: {
          character_id: string
          created_at?: string
          event?: Json
          from_scene_id?: string | null
          id?: string
          story_context?: string | null
          story_id: string
          to_scene_id?: string | null
        }
        Update: {
          character_id?: string
          created_at?: string
          event?: Json
          from_scene_id?: string | null
          id?: string
          story_context?: string | null
          story_id?: string
          to_scene_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_change_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_change_events_from_scene_id_fkey"
            columns: ["from_scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_change_events_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_change_events_to_scene_id_fkey"
            columns: ["to_scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      character_reference_sheets: {
        Row: {
          character_id: string
          created_at: string
          created_by: string | null
          id: string
          parent_id: string | null
          prompt_snippet: string | null
          reference_image_url: string | null
          sheet: Json
          status: string
          story_id: string
          updated_at: string
          version: number
        }
        Insert: {
          character_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_id?: string | null
          prompt_snippet?: string | null
          reference_image_url?: string | null
          sheet?: Json
          status?: string
          story_id: string
          updated_at?: string
          version: number
        }
        Update: {
          character_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_id?: string | null
          prompt_snippet?: string | null
          reference_image_url?: string | null
          sheet?: Json
          status?: string
          story_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_reference_sheets_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_reference_sheets_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "character_reference_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_reference_sheets_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          id: string
          user_id: string
          amount: number
          transaction_type: string
          description: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          transaction_type: string
          description?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          transaction_type?: string
          description?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      image_generation_attempts: {
        Row: {
          id: string
          request_id: string
          status: string
          error_message: string | null
          metadata: Json | null
          user_id: string | null
          story_id: string | null
          scene_id: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          request_id: string
          status: string
          error_message?: string | null
          metadata?: Json | null
          user_id?: string | null
          story_id?: string | null
          scene_id?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          request_id?: string
          status?: string
          error_message?: string | null
          metadata?: Json | null
          user_id?: string | null
          story_id?: string | null
          scene_id?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      consistency_logs: {
        Row: {
          check_type: string
          created_at: string
          details: Json | null
          id: string
          scene_id: string | null
          status: string
          story_id: string
        }
        Insert: {
          check_type: string
          created_at?: string
          details?: Json | null
          id?: string
          scene_id?: string | null
          status: string
          story_id: string
        }
        Update: {
          check_type?: string
          created_at?: string
          details?: Json | null
          id?: string
          scene_id?: string | null
          status?: string
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consistency_logs_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consistency_logs_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          preferred_style: string | null
          updated_at: string
          user_id: string
          credits_balance: number
          is_admin: boolean
          subscription_tier: string
          subscription_status: string | null
          next_billing_date: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_admin?: boolean
          preferred_style?: string | null
          updated_at?: string
          user_id: string
          credits_balance?: number
          subscription_tier?: string
          subscription_status?: string | null
          next_billing_date?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_admin?: boolean
          preferred_style?: string | null
          updated_at?: string
          user_id?: string
          credits_balance?: number
          subscription_tier?: string
          subscription_status?: string | null
          next_billing_date?: string | null
        }
        Relationships: []
      }
      scenes: {
        Row: {
          characters: string[] | null
          character_states: Json | null
          consistency_details: Json | null
          consistency_score: number | null
          consistency_status: string | null
          created_at: string
          emotional_tone: string | null
          generation_status: string | null
          id: string
          image_prompt: string | null
          image_url: string | null
          original_text: string | null
          scene_number: number
          setting: string | null
          story_id: string
          summary: string | null
          title: string | null
          updated_at: string
          user_feedback: string | null
          user_rating: number | null
        }
        Insert: {
          characters?: string[] | null
          character_states?: Json | null
          consistency_details?: Json | null
          consistency_score?: number | null
          consistency_status?: string | null
          created_at?: string
          emotional_tone?: string | null
          generation_status?: string | null
          id?: string
          image_prompt?: string | null
          image_url?: string | null
          original_text?: string | null
          scene_number: number
          setting?: string | null
          story_id: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_feedback?: string | null
          user_rating?: number | null
        }
        Update: {
          characters?: string[] | null
          character_states?: Json | null
          consistency_details?: Json | null
          consistency_score?: number | null
          consistency_status?: string | null
          created_at?: string
          emotional_tone?: string | null
          generation_status?: string | null
          id?: string
          image_prompt?: string | null
          image_url?: string | null
          original_text?: string | null
          scene_number?: number
          setting?: string | null
          story_id?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_feedback?: string | null
          user_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scenes_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_optimizations: {
        Row: {
          created_at: string
          final_prompt_text: string | null
          framework_version: string
          id: string
          model_used: string | null
          optimized_prompt: Json | null
          original_input: string | null
          scene_id: string | null
          story_id: string
        }
        Insert: {
          created_at?: string
          final_prompt_text?: string | null
          framework_version: string
          id?: string
          model_used?: string | null
          optimized_prompt?: Json | null
          original_input?: string | null
          scene_id?: string | null
          story_id: string
        }
        Update: {
          created_at?: string
          final_prompt_text?: string | null
          framework_version?: string
          id?: string
          model_used?: string | null
          optimized_prompt?: Json | null
          original_input?: string | null
          scene_id?: string | null
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_optimizations_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_optimizations_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      stories: {
        Row: {
          active_style_guide_id: string | null
          art_style: string | null
          aspect_ratio: string | null
          consistency_settings: Json | null
          created_at: string
          description: string | null
          id: string
          original_content: string | null
          original_filename: string | null
          scene_count: number | null
          status: string
          title: string
          updated_at: string
          user_id: string
          word_count: number | null
        }
        Insert: {
          active_style_guide_id?: string | null
          art_style?: string | null
          aspect_ratio?: string | null
          consistency_settings?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          original_content?: string | null
          original_filename?: string | null
          scene_count?: number | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          word_count?: number | null
        }
        Update: {
          active_style_guide_id?: string | null
          art_style?: string | null
          aspect_ratio?: string | null
          consistency_settings?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          original_content?: string | null
          original_filename?: string | null
          scene_count?: number | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          word_count?: number | null
        }
        Relationships: []
      }
      scene_character_states: {
        Row: {
          character_id: string
          created_at: string
          id: string
          scene_id: string
          source: string
          state: Json
          story_context: string | null
          story_id: string
          updated_at: string
        }
        Insert: {
          character_id: string
          created_at?: string
          id?: string
          scene_id: string
          source?: string
          state?: Json
          story_context?: string | null
          story_id: string
          updated_at?: string
        }
        Update: {
          character_id?: string
          created_at?: string
          id?: string
          scene_id?: string
          source?: string
          state?: Json
          story_context?: string | null
          story_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_character_states_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_character_states_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_character_states_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_consistency_metrics: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          metrics: Json
          overall_score: number | null
          scene_id: string
          status: string
          story_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          metrics?: Json
          overall_score?: number | null
          scene_id: string
          status: string
          story_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          metrics?: Json
          overall_score?: number | null
          scene_id?: string
          status?: string
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_consistency_metrics_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_consistency_metrics_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      story_style_guides: {
        Row: {
          created_at: string
          created_by: string | null
          guide: Json
          id: string
          parent_id: string | null
          status: string
          story_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guide?: Json
          id?: string
          parent_id?: string | null
          status?: string
          story_id: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guide?: Json
          id?: string
          parent_id?: string | null
          status?: string
          story_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "story_style_guides_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "story_style_guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_style_guides_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      refund_consumed_credits: {
        Args: {
          p_user_id: string
          p_request_id: string
          p_reason: string
          p_metadata: Json
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
