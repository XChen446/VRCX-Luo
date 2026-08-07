using System;
using System.Drawing;
using System.Windows.Forms;

namespace VRCX
{
    internal sealed class CloseToTrayPrompt : Form
    {
        private static readonly Color BackgroundColor = Color.FromArgb(10, 10, 10);
        private static readonly Color SurfaceColor = Color.FromArgb(24, 24, 27);
        private static readonly Color BorderColor = Color.FromArgb(63, 63, 70);
        private static readonly Color PrimaryTextColor = Color.FromArgb(250, 250, 250);
        private static readonly Color SecondaryTextColor = Color.FromArgb(161, 161, 170);

        public bool DontAskAgain => _dontAskAgainCheckBox.Checked;
        internal Button CancelButtonControl => _cancelButton;
        internal event Action<CloseToTrayPromptResult, bool> ChoiceSelected;

        private readonly CheckBox _dontAskAgainCheckBox;
        private readonly Button _cancelButton;

        public CloseToTrayPrompt()
        {
            AutoScaleMode = AutoScaleMode.None;
            BackColor = BackgroundColor;
            ClientSize = new Size(520, 286);
            DoubleBuffered = true;
            Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular);
            FormBorderStyle = FormBorderStyle.None;
            ForeColor = PrimaryTextColor;
            KeyPreview = true;
            MaximizeBox = false;
            MinimizeBox = false;
            Padding = new Padding(1);
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;

            Paint += (_, e) =>
                ControlPaint.DrawBorder(
                    e.Graphics,
                    ClientRectangle,
                    BorderColor,
                    ButtonBorderStyle.Solid
                );
            Shown += (_, _) => CenterOnOwner();
            KeyDown += (_, e) =>
            {
                if (e.KeyCode == Keys.Escape)
                {
                    CancelPrompt();
                }
            };

            var headerPanel = new Panel
            {
                BackColor = SurfaceColor,
                Dock = DockStyle.Top,
                Height = 46
            };
            var headerLabel = new Label
            {
                AutoSize = true,
                Font = new Font(Font.FontFamily, 10F, FontStyle.Regular),
                ForeColor = Color.FromArgb(212, 212, 216),
                Location = new Point(18, 13),
                Text = "关闭 VRCX-K"
            };
            var closeButton = CreateFlatButton(
                text: "×",
                location: new Point(474, 6),
                size: new Size(38, 32),
                backColor: SurfaceColor,
                hoverColor: BorderColor,
                foreColor: SecondaryTextColor
            );
            closeButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            closeButton.Font = new Font(Font.FontFamily, 16F, FontStyle.Regular);
            closeButton.TabStop = false;
            closeButton.AccessibleName = "取消关闭";
            closeButton.Click += (_, _) => CancelPrompt();
            headerPanel.Controls.Add(headerLabel);
            headerPanel.Controls.Add(closeButton);

            var titleLabel = new Label
            {
                AutoSize = true,
                Font = new Font(Font.FontFamily, 12F, FontStyle.Bold),
                ForeColor = PrimaryTextColor,
                Location = new Point(24, 72),
                Text = "是否最小化到系统托盘？"
            };
            var detailLabel = new Label
            {
                AutoSize = false,
                ForeColor = SecondaryTextColor,
                Location = new Point(24, 108),
                Size = new Size(472, 48),
                Text = "最小化后 VRCX-K 会继续在后台运行，您可以随时从托盘图标重新打开。"
            };
            _dontAskAgainCheckBox = new CheckBox
            {
                AutoSize = true,
                BackColor = BackgroundColor,
                ForeColor = Color.FromArgb(212, 212, 216),
                Location = new Point(24, 164),
                Text = "以后不再提示",
                UseVisualStyleBackColor = false
            };

            var separator = new Panel
            {
                BackColor = Color.FromArgb(39, 39, 42),
                Location = new Point(1, 207),
                Size = new Size(518, 1),
                Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom
            };

            _cancelButton = CreateFlatButton(
                text: "取消",
                location: new Point(190, 228),
                size: new Size(84, 36),
                backColor: SurfaceColor,
                hoverColor: BorderColor,
                foreColor: Color.FromArgb(228, 228, 231),
                borderColor: BorderColor
            );
            _cancelButton.DialogResult = DialogResult.Cancel;
            _cancelButton.Click += (_, _) => CancelPrompt();

            var exitButton = CreateFlatButton(
                text: "直接退出",
                location: new Point(282, 228),
                size: new Size(96, 36),
                backColor: SurfaceColor,
                hoverColor: Color.FromArgb(69, 10, 10),
                foreColor: Color.FromArgb(248, 113, 113),
                borderColor: Color.FromArgb(127, 29, 29)
            );
            exitButton.Click += (_, _) => Choose(CloseToTrayPromptResult.Exit);

            var minimizeButton = CreateFlatButton(
                text: "最小化到托盘",
                location: new Point(386, 228),
                size: new Size(112, 36),
                backColor: Color.FromArgb(37, 99, 235),
                hoverColor: Color.FromArgb(29, 78, 216),
                foreColor: Color.White
            );
            minimizeButton.Click += (_, _) => Choose(CloseToTrayPromptResult.MinimizeToTray);

            AcceptButton = minimizeButton;
            CancelButton = _cancelButton;
            Controls.AddRange(new Control[]
            {
                headerPanel,
                titleLabel,
                detailLabel,
                _dontAskAgainCheckBox,
                separator,
                _cancelButton,
                exitButton,
                minimizeButton
            });
        }

        protected override CreateParams CreateParams
        {
            get
            {
                const int DropShadow = 0x00020000;
                var createParams = base.CreateParams;
                createParams.ClassStyle |= DropShadow;
                return createParams;
            }
        }

        private static Button CreateFlatButton(
            string text,
            Point location,
            Size size,
            Color backColor,
            Color hoverColor,
            Color foreColor,
            Color? borderColor = null
        )
        {
            var button = new Button
            {
                BackColor = backColor,
                FlatStyle = FlatStyle.Flat,
                ForeColor = foreColor,
                Location = location,
                Size = size,
                Text = text,
                UseVisualStyleBackColor = false
            };
            button.FlatAppearance.BorderColor = borderColor ?? backColor;
            button.FlatAppearance.BorderSize = borderColor.HasValue ? 1 : 0;
            button.FlatAppearance.MouseDownBackColor = hoverColor;
            button.FlatAppearance.MouseOverBackColor = hoverColor;
            return button;
        }

        private void CenterOnOwner()
        {
            if (Owner == null)
            {
                CenterToScreen();
                return;
            }

            var ownerBounds = Owner.Bounds;
            var screenBounds = Screen.FromControl(Owner).WorkingArea;
            var x = ownerBounds.Left + (ownerBounds.Width - Width) / 2;
            var y = ownerBounds.Top + (ownerBounds.Height - Height) / 2;
            x = Math.Max(screenBounds.Left, Math.Min(x, screenBounds.Right - Width));
            y = Math.Max(screenBounds.Top, Math.Min(y, screenBounds.Bottom - Height));
            Location = new Point(x, y);
        }

        private void CancelPrompt()
        {
            Close();
        }

        private void Choose(CloseToTrayPromptResult result)
        {
            var handler = ChoiceSelected;
            var dontAskAgain = DontAskAgain;
            Close();
            handler?.Invoke(result, dontAskAgain);
        }
    }
}
