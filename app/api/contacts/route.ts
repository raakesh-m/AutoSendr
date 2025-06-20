import { NextRequest, NextResponse } from "next/server";
import { query, Contact } from "@/lib/db";

// GET - Fetch all contacts
export async function GET() {
  try {
    const result = await query(
      "SELECT * FROM contacts ORDER BY created_at DESC"
    );
    return NextResponse.json({ contacts: result.rows });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}

// POST - Create contacts from uploaded data
export async function POST(request: NextRequest) {
  try {
    const { contacts } = await request.json();

    if (!Array.isArray(contacts)) {
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );
    }

    const insertedContacts = [];

    for (const contact of contacts) {
      try {
        const result = await query(
          `INSERT INTO contacts (email, name, company_name, role, recruiter_name, additional_info) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           ON CONFLICT (email) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, contacts.name),
           company_name = COALESCE(EXCLUDED.company_name, contacts.company_name),
           role = COALESCE(EXCLUDED.role, contacts.role),
           recruiter_name = COALESCE(EXCLUDED.recruiter_name, contacts.recruiter_name),
           additional_info = COALESCE(EXCLUDED.additional_info, contacts.additional_info),
           updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [
            contact.email,
            contact.name || null,
            contact.company_name || contact.companyName || null,
            contact.role || contact.position || null,
            contact.recruiter_name || contact.recruiterName || null,
            contact.additional_info || {},
          ]
        );
        insertedContacts.push(result.rows[0]);
      } catch (error) {
        console.error("Error inserting contact:", contact.email, error);
      }
    }

    return NextResponse.json({
      message: `Successfully processed ${insertedContacts.length} contacts`,
      contacts: insertedContacts,
    });
  } catch (error) {
    console.error("Error processing contacts:", error);
    return NextResponse.json(
      { error: "Failed to process contacts" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a contact
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Contact ID required" },
        { status: 400 }
      );
    }

    // Check if contact has email sends
    const emailSendsCheck = await query(
      "SELECT COUNT(*) as count FROM email_sends WHERE contact_id = $1",
      [id]
    );

    const emailSendCount = parseInt(emailSendsCheck.rows[0].count);

    if (emailSendCount > 0) {
      // Option 1: Delete related email sends first (CASCADE delete)
      await query("DELETE FROM email_sends WHERE contact_id = $1", [id]);
      console.log(
        `Deleted ${emailSendCount} email send records for contact ${id}`
      );
    }

    // Now delete the contact
    const deleteResult = await query(
      "DELETE FROM contacts WHERE id = $1 RETURNING *",
      [id]
    );

    if (deleteResult.rowCount === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json({
      message: "Contact deleted successfully",
      emailSendsDeleted: emailSendCount,
    });
  } catch (error) {
    console.error("Error deleting contact:", error);

    // Handle specific PostgreSQL foreign key constraint errors
    if (error instanceof Error && error.message.includes("23503")) {
      return NextResponse.json(
        {
          error:
            "Cannot delete contact because it has associated email records. Please contact support.",
          code: "FOREIGN_KEY_CONSTRAINT",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to delete contact" },
      { status: 500 }
    );
  }
}
