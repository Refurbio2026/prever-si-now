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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      company_ai_reports: {
        Row: {
          created_at: string
          financial_score: number
          generated_at: string
          growth_score: number
          ico: string
          id: string
          overall_score: number
          public_score: number
          recommendation: string
          strengths: Json
          summary: string
          updated_at: string
          warnings: Json
          weaknesses: Json
        }
        Insert: {
          created_at?: string
          financial_score: number
          generated_at?: string
          growth_score: number
          ico: string
          id?: string
          overall_score: number
          public_score: number
          recommendation: string
          strengths?: Json
          summary: string
          updated_at?: string
          warnings?: Json
          weaknesses?: Json
        }
        Update: {
          created_at?: string
          financial_score?: number
          generated_at?: string
          growth_score?: number
          ico?: string
          id?: string
          overall_score?: number
          public_score?: number
          recommendation?: string
          strengths?: Json
          summary?: string
          updated_at?: string
          warnings?: Json
          weaknesses?: Json
        }
        Relationships: []
      }
      company_cache: {
        Row: {
          data: Json
          fetched_at: string
          ico: string
          updated_at: string
        }
        Insert: {
          data: Json
          fetched_at?: string
          ico: string
          updated_at?: string
        }
        Update: {
          data?: Json
          fetched_at?: string
          ico?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_changes: {
        Row: {
          change_type: string
          description: string | null
          detected_at: string
          ico: string
          id: string
          severity: string
          title: string
        }
        Insert: {
          change_type: string
          description?: string | null
          detected_at?: string
          ico: string
          id?: string
          severity?: string
          title: string
        }
        Update: {
          change_type?: string
          description?: string | null
          detected_at?: string
          ico?: string
          id?: string
          severity?: string
          title?: string
        }
        Relationships: []
      }
      company_history: {
        Row: {
          created_at: string
          description: string | null
          event_date: string | null
          event_type: string
          ico: string
          id: string
          imported_at: string
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type: string
          ico: string
          id?: string
          imported_at?: string
          source?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type?: string
          ico?: string
          id?: string
          imported_at?: string
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_people: {
        Row: {
          created_at: string
          ico: string
          id: string
          imported_at: string
          person_name: string
          role: string
          source: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          ico: string
          id?: string
          imported_at?: string
          person_name: string
          role: string
          source?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          ico?: string
          id?: string
          imported_at?: string
          person_name?: string
          role?: string
          source?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      company_registry: {
        Row: {
          address: string | null
          created_at: string
          ico: string
          id: string
          imported_at: string
          legal_form: string | null
          name: string | null
          registration_date: string | null
          registration_number: string | null
          source: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          ico: string
          id?: string
          imported_at?: string
          legal_form?: string | null
          name?: string | null
          registration_date?: string | null
          registration_number?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          ico?: string
          id?: string
          imported_at?: string
          legal_form?: string | null
          name?: string | null
          registration_date?: string | null
          registration_number?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_snapshots: {
        Row: {
          created_at: string
          data: Json
          ico: string
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          ico: string
          id?: string
        }
        Update: {
          created_at?: string
          data?: Json
          ico?: string
          id?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          ico: string
          id: string
          records_count: number
          source: string
          started_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          ico: string
          id?: string
          records_count?: number
          source: string
          started_at?: string
          status: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          ico?: string
          id?: string
          records_count?: number
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      import_queue: {
        Row: {
          attempts: number
          created_at: string
          finished_at: string | null
          force_refresh: boolean
          ico: string
          id: string
          last_error: string | null
          priority: number
          source: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          force_refresh?: boolean
          ico: string
          id?: string
          last_error?: string | null
          priority?: number
          source: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          force_refresh?: boolean
          ico?: string
          id?: string
          last_error?: string | null
          priority?: number
          source?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          email: string | null
          id: string
          plan: string
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          id: string
          plan?: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      recent_searches: {
        Row: {
          company_name: string | null
          created_at: string
          ico: string | null
          id: string
          query: string
          user_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          ico?: string | null
          id?: string
          query: string
          user_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          ico?: string | null
          id?: string
          query?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          company_name: string
          created_at: string
          ico: string
          id: string
          report_type: string
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          ico: string
          id?: string
          report_type?: string
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          ico?: string
          id?: string
          report_type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      watched_companies: {
        Row: {
          company_name: string
          created_at: string
          ico: string
          id: string
          risk_score: number | null
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          ico: string
          id?: string
          risk_score?: number | null
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          ico?: string
          id?: string
          risk_score?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
