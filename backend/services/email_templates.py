

def get_invitation_email_template(
    candidate_name: str,
    role_title: str,
    round_type: str,
    login_url: str,
    deadline_text: str,
    instructions: str = "",
    password: str = None,
    email: str = None
) -> str:
    """
    Generates a professional, responsive HTML email template for candidate invitations.
    Includes a Magic Link button and optional Credentials.
    """
    
    # Theme Colors
    primary_color = "#2563EB" # Blue 600
    bg_color = "#F8FAFC" # Slate 50
    text_color = "#1E293B" # Slate 800
    
    # Process instructions to HTML list if needed, or simple paragraph
    description_html = ""
    if instructions and instructions != "None":
        description_html = f"""
        <div style="background-color: #F1F5F9; border-left: 4px solid {primary_color}; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; font-weight: bold; color: {text_color};">Special Instructions:</p>
            <p style="margin: 5px 0 0 0; color: #475569;">{instructions.replace("{", "{{").replace("}", "}}")}</p>
        </div>
        """

    # Credentials Block
    credentials_html = ""
    if password and email:
        credentials_html = f"""
        <div style="background-color: #ffffff; border: 2px solid #E2E8F0; padding: 20px; margin: 25px 0; border-radius: 8px; text-align: left;">
            <p style="margin: 0 0 15px 0; font-size: 16px; font-weight: 700; color: #1E293B; border-bottom: 1px solid #E2E8F0; padding-bottom: 8px;">Login Credentials</p>
            
            <div style="margin-bottom: 12px;">
                <span style="display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px;">Login Email</span>
                <span style="display: block; font-size: 15px; font-family: monospace; color: #334155; background: #F8FAFC; padding: 8px 12px; border-radius: 4px; border: 1px solid #CBD5E1; margin-top: 4px;">{email}</span>
            </div>
            
            <div style="margin-bottom: 15px;">
                <span style="display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px;">Temporary Password</span>
                <span style="display: block; font-size: 15px; font-family: monospace; color: #334155; background: #F8FAFC; padding: 8px 12px; border-radius: 4px; border: 1px solid #CBD5E1; margin-top: 4px;">{password}</span>
            </div>
            
            <p style="margin: 0; font-size: 13px; color: #64748B; font-style: italic;">
                * You will be asked to log in using these credentials before starting the assessment.
            </p>
        </div>
        """

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interview Invitation</title>
    <style>
        body {{
            font-family: 'Segoe UI', localhost, sans-serif;
            margin: 0;
            padding: 0;
            background-color: {bg_color};
            color: {text_color};
            line-height: 1.6;
        }}
        .container {{
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
            margin-top: 40px;
            margin-bottom: 40px;
        }}
        .header {{
            background: linear-gradient(135deg, #5d8c2c 0%, #7aa839 100%);
            padding: 40px 30px 30px 30px;
            text-align: center;
        }}
        .logo-container {{
            margin-bottom: 20px;
        }}
        .header h1 {{
            color: #ffffff;
            margin: 15px 0 0 0;
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 0.5px;
        }}
        .header-subtitle {{
            color: rgba(255, 255, 255, 0.95);
            font-size: 18px;
            font-weight: 600;
            margin-top: 8px;
        }}
        .logo-text {{
            color: #ffffff;
            font-size: 26px;
            font-weight: 800;
            margin-bottom: 10px;
            display: inline-block;
        }}
        .content {{
            padding: 40px 30px;
        }}
        .greeting {{
            font-size: 18px;
            margin-bottom: 20px;
        }}
        .role-badge {{
            display: inline-block;
            background-color: #dcfce7;
            color: #166534;
            padding: 6px 14px;
            border-radius: 9999px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 20px;
        }}
        .cta-button {{
            display: inline-block;
            background: linear-gradient(to right, #5d8c2c, #7aa839);
            color: #ffffff !important;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            margin: 30px 0;
            box-shadow: 0 4px 12px rgba(93, 140, 44, 0.3);
            text-align: center;
        }}
        .cta-button:hover {{
            opacity: 0.9;
        }}
        .deadline-box {{
            text-align: center;
            color: #DC2626;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 30px;
        }}
        .footer {{
            background-color: #F8FAFC;
            padding: 30px;
            text-align: center;
            font-size: 12px;
            color: #94A3B8;
            border-top: 1px solid #E2E8F0;
        }}
        .secure-notice {{
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 20px;
            font-size: 13px;
            color: #64748B;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-container">
                <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAACgAAAAJxCAMAAAC5GxvpAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAaVBMVEVMfiJJeiFJeSBJeSFJeiFJeSBIeiFIeSFJeiFJeiFJeiFIeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFVTyU+AAAAInRSTlMBDRASGSAkMTdBRFFiZm9yfYOHk6Ons8HN09jg5ezy9vn6cv6DQgAAPgBJREFUeNrs3Vty2kAQBVAJOQIPKLgYJJgYSWj2v8j4Mx9JpWzzkKrOWcWt7p47xZyVZR1CiO2HS/67S/shhhDqsiwAAFis6iXsmrbr3sdxzP83jmPqurbZhZeqAABgUcr1pokx/RrzVwy/Uoy7zUsBAMACrKrXpj31wzV/zzik7rDdmAUCAMxaHQ5dGvLt9Cnu10IgAMAcrertobuM+eam4dzuTAIBAOalWr+d3qd8P0OKWzeBAADzUFYhpn7K9zambr/WEgMA8Gx106VrfpReBgQAeKoqHC9Tfqip7/Z2wQAAT1FuY7rmJ5hS3K4KAAAeqqzfujE/zXg61FbBAACPs3o9pik/16UNqmEAAB6ias59noEhuQYEAHiAujlf80xM6W1TAABwT+uYrnlO+igCAgDc8FoECABMjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwA" alt="ThirdEye Logo" style="width: 120px; height: auto; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;">
                <div class="logo-text">HiringAI</div>
            </div>
            <h1>Invitation to {round_type.title()}</h1>
            <div class="header-subtitle">Your next opportunity awaits</div>
        </div>
        
        <div class="content">
            <div class="greeting">Hello <strong>{candidate_name}</strong>,</div>
            
            <p>
                We are pleased to invite you to the <strong>{round_type.title()}</strong> for the following position:
            </p>
            
            <div style="text-align: center;">
                <span class="role-badge">{role_title}</span>
            </div>
            
            <p>
                Our AI-powered assessment platform is designed to provide you with a fair and comprehensive evaluation. 
                Please ensure you are in a quiet environment with a stable internet connection before starting.
            </p>

            {description_html}

            <div style="text-align: center;">
                <a href="{login_url}" class="cta-button">Go to Candidate Portal</a>
            </div>

            <div style="background-color: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px; padding: 12px; margin: 15px 0; word-break: break-all; text-align: left;">
                <span style="font-size: 11px; font-weight: bold; color: #64748B; text-transform: uppercase;">Direct Portal Link:</span><br/>
                <a href="{login_url}" style="font-size: 13px; color: #2563EB; font-family: monospace; font-weight: 600; text-decoration: underline;">{login_url}</a>
            </div>

            {credentials_html}

            <div class="deadline-box">
                ⏰ {deadline_text}
            </div>

            <div style="border-top: 1px dashed #CBD5E1; margin: 20px 0;"></div>
            
            <p style="font-size: 14px; color: #64748B;">
                <strong>Instructions:</strong><br>
                1. Click the button above to visit the portal.<br>
                2. Enter your Email and the Temporary Password provided above.<br>
                3. You will be guided to the assessment instructions.
            </p>
        </div>

        <div class="footer">
            <p>&copy; {2026} HiringAI. All rights reserved.</p>
            <p>If you have any questions, please reply to this email.</p>
        </div>
    </div>
</body>
</html>
    """
    return html_content

def get_completion_email_template(
    candidate_name: str,
    role_title: str,
    round_type: str
) -> str:
    """
    Generates a thank-you email after assessment completion.
    NO SCORES included.
    """
    
    # Theme Colors
    bg_color = "#F8FAFC"
    text_color = "#1E293B"

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Assessment Completed</title>
    <style>
        body {{
            font-family: 'Segoe UI', localhost, sans-serif;
            margin: 0;
            padding: 0;
            background-color: {bg_color};
            color: {text_color};
            line-height: 1.6;
        }}
        .container {{
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
            margin-top: 40px;
            margin-bottom: 40px;
        }}
        .header {{
            background: linear-gradient(135deg, #5d8c2c 0%, #7aa839 100%);
            padding: 40px 30px;
            text-align: center;
        }}
        .logo {{
            display: inline-block;
            margin-bottom: 15px;
        }}
        .logo img {{
            max-width: 100px;
            height: auto;
        }}
        .logo-text {{
            color: #ffffff;
            font-size: 28px;
            font-weight: 800;
            margin-top: 10px;
        }}
        .content {{
            padding: 40px 30px;
            text-align: center;
        }}
        .icon {{
            font-size: 48px;
            margin-bottom: 20px;
        }}
        .footer {{
            background-color: #F8FAFC;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #94A3B8;
            border-top: 1px solid #E2E8F0;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">
                <img src="https://raw.githubusercontent.com/thirdeye-data/assets/main/logo.png" alt="ThirdEye Logo" style="width: 80px;">
            </div>
            <div class="logo-text">HiringAI</div>
        </div>
        
        <div class="content">
            <div class="icon">✅</div>
            <h2 style="color: #5d8c2c; margin-bottom: 10px; font-size: 24px; font-weight: bold;">Assessment Completed</h2>
            <p style="font-size: 16px; color: #475569; margin-bottom: 30px;">
                Thank you for your time.
            </p>
            
            <p style="text-align: left; background-color: #F1F5F9; padding: 20px; border-radius: 8px;">
                Hello <strong>{candidate_name}</strong>,<br><br>
                Thank you for attending the <strong>{round_type.title()}</strong> for the <strong>{role_title}</strong> position.<br><br>
                Our hiring team is currently reviewing your performance. 
                You will be notified via email regarding the next steps.
            </p>
            
            <p style="margin-top: 30px; color: #64748B;">
                Best regards,<br>
                <strong>HiringAI Team</strong>
            </p>
        </div>

        <div class="footer">
            <p>&copy; {2026} HiringAI. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    """
    return html_content

def get_offer_email_template(
    candidate_name: str,
    role_title: str
) -> str:
    """
    Generates a professional offer release email.
    """
    primary_color = "#10B981" # Green 500
    bg_color = "#F0FDF4" # Green 50
    text_color = "#064E3B" # Dark Green 900

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offer Released</title>
    <style>
        body {{
            font-family: 'Segoe UI', sans-serif;
            margin: 0;
            padding: 0;
            background-color: {bg_color};
            color: {text_color};
            line-height: 1.6;
        }}
        .container {{
            max-width: 600px;
            margin: 40px auto;
            background-color: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            border: 1px solid #D1FAE5;
        }}
        .header {{
            background: linear-gradient(135deg, #5d8c2c 0%, #7aa839 100%);
            padding: 50px 30px;
            text-align: center;
        }}
        .logo-container {{
            margin-bottom: 20px;
        }}
        .logo-text {{
            color: #ffffff;
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 10px;
            display: inline-block;
        }}
        .content {{
            padding: 40px 30px;
            text-align: center;
        }}
        .confetti {{
            font-size: 48px;
            margin-bottom: 20px;
        }}
        .congrats {{
            color: {primary_color};
            font-size: 24px;
            font-weight: 800;
            margin-bottom: 20px;
        }}
        .footer {{
            background-color: #F8FAFC;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #6B7280;
            border-top: 1px solid #E5E7EB;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-container">
                <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAACgAAAAJxCAMAAAC5GxvpAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAaVBMVEVMfiJJeiFJeSBJeSFJeiFJeSBIeiFIeSFJeiFJeiFJeiFIeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFJeiFVTyU+AAAAInRSTlMBDRASGSAkMTdBRFFiZm9yfYOHk6Ons8HN09jg5ezy9vn6cv6DQgAAPgBJREFUeNrs3Vty2kAQBVAJOQIPKLgYJJgYSWj2v8j4Mx9JpWzzkKrOWcWt7p47xZyVZR1CiO2HS/67S/shhhDqsiwAAFis6iXsmrbr3sdxzP83jmPqurbZhZeqAABgUcr1pokx/RrzVwy/Uoy7zUsBAMACrKrXpj31wzV/zzik7rDdmAUCAMxaHQ5dGvLt9Cnu10IgAMAcrertobuM+eam4dzuTAIBAOalWr+d3qd8P0OKWzeBAADzUFYhpn7K9zambr/WEgMA8Gx106VrfpReBgQAeKoqHC9Tfqip7/Z2wQAAT1FuY7rmJ5hS3K4KAAAeqqzfujE/zXg61FbBAACPs3o9pik/16UNqmEAAB6ias59noEhuQYEAHiAujlf80xM6W1TAABwT+uYrnlO+igCAgDc8FoECABMjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwACACQjAAIAJCMAAgAkIwA" alt="ThirdEye Logo" style="width: 120px; height: auto; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;">
                <div class="logo-text">HiringAI</div>
            </div>
        </div>
        
        <div class="content">
            <div class="confetti">🎉</div>
            <div class="congrats">Congratulations!</div>
            
            <p style="font-size: 18px; margin-bottom: 25px;">
                Hello <strong>{candidate_name}</strong>,
            </p>
            
            <p style="font-size: 16px; margin-bottom: 30px;">
                We are thrilled to inform you that you have been selected for the <strong>{role_title}</strong> position at our organization.
            </p>
            
            <div style="background-color: #ECFDF5; border: 2px solid #D1FAE5; padding: 25px; border-radius: 12px; margin-bottom: 30px; text-align: left;">
                <p style="margin: 0; font-size: 16px; font-weight: 600;">Next Steps:</p>
                <p style="margin: 10px 0 0 0; font-size: 14px; color: #065F46;">
                    Our HR team will reach out to you shortly with the formal offer letter and onboarding documentation. 
                    Please keep an eye on your inbox for further instructions.
                </p>
            </div>
            
            <p style="color: #6B7280; font-size: 14px;">
                We look forward to having you on board!
            </p>
        </div>

        <div class="footer">
            <p>&copy; 2026 HiringAI. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    """
    return html_content
